import test from 'node:test';
import assert from 'node:assert/strict';

import { IngestionWorker } from '../../src/ingestion/worker';

test('ING-005: deve executar poll e persistir snapshots normalizados', async () => {
  const persisted: unknown[] = [];

  const worker = new IngestionWorker({
    pollIntervalMs: 1000,
    gamma: {
      getEvents: async () => [
        {
          id: 'm-1',
          slug: 'btc-updown',
          question: 'BTC up?',
          active: true,
          tokens: [{ token_id: 'yes-token', outcome: 'Yes', price: '0.55' }]
        }
      ]
    },
    clob: {
      getOrderBook: async ({ tokenId }) => ({
        tokenId,
        marketId: 'm-1',
        bids: [{ price: 0.54, size: 100 }],
        asks: [{ price: 0.56, size: 90 }],
        timestamp: '2026-04-21T20:30:00.000Z'
      })
    },
    realtime: {
      setMessageHandler: () => undefined,
      connect: () => undefined,
      disconnect: () => undefined,
      subscribe: () => undefined
    },
    saveSnapshot: async (entry) => {
      persisted.push(entry);
    }
  });

  await worker.pollOnce();

  assert.equal(persisted.length, 2); // market + orderbook
  const metrics = worker.getMetrics();
  assert.equal(metrics.pollCycles, 1);
  assert.equal(metrics.snapshotsPersisted, 2);
  assert.equal(worker.getCheckpoint() !== null, true);
});

test('ING-005: deve processar mensagem de stream e atualizar métricas', async () => {
  const persisted: unknown[] = [];
  let handler: ((message: unknown) => Promise<void>) | null = null;

  const worker = new IngestionWorker({
    pollIntervalMs: 1000,
    gamma: { getEvents: async () => [] },
    clob: { getOrderBook: async () => ({ marketId: 'm-1', tokenId: 't-1', bids: [], asks: [], timestamp: new Date().toISOString() }) },
    realtime: {
      setMessageHandler: (cb) => {
        handler = cb;
      },
      connect: () => undefined,
      disconnect: () => undefined,
      subscribe: () => undefined
    },
    saveSnapshot: async (entry) => {
      persisted.push(entry);
    }
  });

  worker.start();
  await handler?.({ event: 'trade', market: 'm-1', token_id: 't-1', side: 'BUY', price: '0.57', size: '20', trade_id: 't-200' });
  worker.stop();

  assert.equal(persisted.length, 1);
  const metrics = worker.getMetrics();
  assert.equal(metrics.streamMessages, 1);
  assert.equal(metrics.snapshotsPersisted, 1);
});
