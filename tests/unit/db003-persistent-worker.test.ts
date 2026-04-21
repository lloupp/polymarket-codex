import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { newDb } from 'pg-mem';

import { PgMigrationRunner, loadSqlMigrations } from '../../src/storage/migrations';
import { PersistentIngestionService } from '../../src/ingestion/persistent-worker';

type RealtimeHandler = (message: unknown) => Promise<void>;

function createRealtimeStub() {
  let handler: RealtimeHandler | null = null;

  return {
    setMessageHandler(next: RealtimeHandler) {
      handler = next;
    },
    connect() {
      return undefined;
    },
    disconnect() {
      return undefined;
    },
    subscribe() {
      return undefined;
    },
    async emit(message: unknown) {
      if (handler) {
        await handler(message);
      }
    }
  };
}

async function setupDb() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const client = new adapter.Client();
  await client.connect();

  const migrations = await loadSqlMigrations(path.resolve(process.cwd(), 'config', 'migrations'));
  const runner = new PgMigrationRunner({ client, migrations });
  await runner.migrateUp();

  return { client };
}

test('DB-003: deve persistir snapshots do worker e finalizar ingestion_run como completed', async () => {
  const { client } = await setupDb();
  const realtime = createRealtimeStub();

  const service = new PersistentIngestionService({
    pollIntervalMs: 10_000,
    client,
    gamma: {
      getEvents: async () => [
        {
          id: 'mkt-1',
          slug: 'market-1',
          question: 'Vai subir?',
          active: true,
          tokens: [{ token_id: 'token-1', outcome: 'YES', price: 0.51 }]
        }
      ]
    },
    clob: {
      getOrderBook: async () => ({
        marketId: 'mkt-1',
        tokenId: 'token-1',
        bids: [{ price: '0.50', size: '100' }],
        asks: [{ price: '0.52', size: '100' }],
        timestamp: '2026-01-01T00:10:00.000Z'
      })
    },
    realtime
  });

  try {
    await service.start();
    await service.pollOnce();
    await realtime.emit({
      trade_id: 'tr-100',
      market: 'mkt-1',
      token_id: 'token-1',
      side: 'BUY',
      price: '0.51',
      size: '10'
    });
    await service.stop('completed');

    const marketRows = (await client.query('select market_id from markets where market_id = $1', ['mkt-1'])).rows;
    const orderbookRows = (
      await client.query('select market_id from orderbook_snapshots where market_id = $1', ['mkt-1'])
    ).rows;
    const tradeRows = (await client.query('select trade_id from trade_ticks where trade_id = $1', ['tr-100'])).rows;
    const runRows = (
      await client.query('select status, error_message from ingestion_runs order by id desc limit 1')
    ).rows as Array<{ status: string; error_message: string | null }>;

    assert.equal(marketRows.length, 1);
    assert.equal(orderbookRows.length, 1);
    assert.equal(tradeRows.length, 1);
    assert.equal(runRows[0]?.status, 'completed');
    assert.equal(runRows[0]?.error_message, null);
  } finally {
    await service.stop('failed');
    await client.end();
  }
});

test('DB-003: deve registrar falha em ingestion_runs quando poll lança erro', async () => {
  const { client } = await setupDb();
  const realtime = createRealtimeStub();

  const service = new PersistentIngestionService({
    pollIntervalMs: 10_000,
    client,
    gamma: {
      getEvents: async () => {
        throw new Error('gamma offline');
      }
    },
    clob: {
      getOrderBook: async () => ({})
    },
    realtime
  });

  try {
    await service.start();

    await assert.rejects(async () => {
      await service.pollOnce();
    }, /gamma offline/);

    const runRows = (
      await client.query('select status, error_message from ingestion_runs order by id desc limit 1')
    ).rows as Array<{ status: string; error_message: string | null }>;

    assert.equal(runRows[0]?.status, 'failed');
    assert.match(runRows[0]?.error_message ?? '', /gamma offline/);
  } finally {
    await service.stop('failed');
    await client.end();
  }
});
