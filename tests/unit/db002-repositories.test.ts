import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { newDb } from 'pg-mem';

import { PgMigrationRunner, loadSqlMigrations } from '../../src/storage/migrations';
import {
  IngestionRunRepository,
  MarketRepository,
  OrderbookRepository,
  TradeTickRepository
} from '../../src/storage/repositories';

async function setupDb() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const client = new adapter.Client();
  await client.connect();

  const migrations = await loadSqlMigrations(path.resolve(process.cwd(), 'config', 'migrations'));
  const runner = new PgMigrationRunner({ client, migrations });
  await runner.migrateUp();

  return { db, client };
}

test('DB-002: deve fazer upsert idempotente de market por market_id', async () => {
  const { client } = await setupDb();
  const repository = new MarketRepository(client);

  await repository.upsert({
    marketId: 'm1',
    slug: 'market-1',
    question: 'Primeira pergunta?',
    active: true,
    endDate: null,
    outcomes: [{ tokenId: 't1', outcome: 'YES', price: 0.51 }]
  });

  await repository.upsert({
    marketId: 'm1',
    slug: 'market-1',
    question: 'Pergunta atualizada?',
    active: true,
    endDate: null,
    outcomes: [{ tokenId: 't1', outcome: 'YES', price: 0.55 }]
  });

  const rows = (await client.query('select market_id, question from markets where market_id = $1', ['m1']))
    .rows as Array<{
    market_id: string;
    question: string;
  }>;

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.question, 'Pergunta atualizada?');

  await client.end();
});

test('DB-002: deve persistir orderbook sem duplicidade para mesma chave natural', async () => {
  const { client } = await setupDb();
  const marketRepo = new MarketRepository(client);
  const orderbookRepo = new OrderbookRepository(client);

  await marketRepo.upsert({
    marketId: 'm2',
    slug: 'market-2',
    question: 'Mercado com orderbook',
    active: true,
    endDate: null,
    outcomes: [{ tokenId: 't2', outcome: 'YES', price: 0.48 }]
  });

  const snapshot = {
    marketId: 'm2',
    tokenId: 't2',
    bids: [{ price: 0.47, size: 100 }],
    asks: [{ price: 0.49, size: 100 }],
    timestamp: '2026-01-01T00:10:00.000Z'
  };

  await orderbookRepo.insert(snapshot);
  await orderbookRepo.insert(snapshot);

  const rows = (
    await client.query(
      'select id from orderbook_snapshots where market_id = $1 and token_id = $2 and snapshot_time = $3',
      ['m2', 't2', '2026-01-01T00:10:00.000Z']
    )
  ).rows;

  assert.equal(rows.length, 1);

  await client.end();
});

test('DB-002: deve persistir trade tick sem duplicidade por trade_id', async () => {
  const { client } = await setupDb();
  const marketRepo = new MarketRepository(client);
  const tradeRepo = new TradeTickRepository(client);

  await marketRepo.upsert({
    marketId: 'm3',
    slug: 'market-3',
    question: 'Mercado com trades',
    active: true,
    endDate: null,
    outcomes: [{ tokenId: 't3', outcome: 'YES', price: 0.6 }]
  });

  const tick = {
    tradeId: 'tr-1',
    marketId: 'm3',
    tokenId: 't3',
    side: 'BUY' as const,
    price: 0.6,
    size: 50,
    timestamp: '2026-01-01T00:20:00.000Z'
  };

  await tradeRepo.insert(tick);
  await tradeRepo.insert(tick);

  const rows = (await client.query('select trade_id from trade_ticks where trade_id = $1', ['tr-1'])).rows;
  assert.equal(rows.length, 1);

  await client.end();
});

test('DB-002: deve registrar início e finalização de ingestão', async () => {
  const { client } = await setupDb();
  const runRepo = new IngestionRunRepository(client);

  const runId = await runRepo.start({ status: 'running' });

  await runRepo.finish({
    id: runId,
    status: 'completed',
    checkpoint: '2026-01-01T00:30:00.000Z',
    errorMessage: null
  });

  const rows = (
    await client.query('select status, checkpoint, completed_at from ingestion_runs where id = $1', [runId])
  ).rows as Array<{ status: string; checkpoint: string | null; completed_at: string | null }>;

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'completed');
  assert.equal(rows[0]?.checkpoint, '2026-01-01T00:30:00.000Z');
  assert.notEqual(rows[0]?.completed_at, null);

  await client.end();
});
