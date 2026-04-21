import test from 'node:test';
import assert from 'node:assert/strict';

import { OrderReconciler } from '../../src/execution/order-reconciler';

test('EXEC-004: deve sincronizar estado local com remoto e convergir status', async () => {
  const localOrders = new Map<string, { status: string }>([
    ['o-1', { status: 'open' }],
    ['o-2', { status: 'open' }]
  ]);

  const localFills: Array<{ fillId: string; orderId: string; size: number; price: number }> = [];

  const reconciler = new OrderReconciler({
    fetchRemoteOrders: async () => [
      { orderId: 'o-1', status: 'filled' },
      { orderId: 'o-2', status: 'expired' }
    ],
    fetchRemoteFills: async () => [
      { fillId: 'f-1', orderId: 'o-1', size: 10, price: 0.51 },
      { fillId: 'f-2', orderId: 'o-1', size: 5, price: 0.52 }
    ],
    getLocalOrder: async (orderId) => localOrders.get(orderId) ?? null,
    upsertLocalOrder: async (order) => {
      localOrders.set(order.orderId, { status: order.status });
    },
    hasLocalFill: async (fillId) => localFills.some((fill) => fill.fillId === fillId),
    persistLocalFill: async (fill) => {
      localFills.push(fill);
    }
  });

  const result = await reconciler.reconcileOnce();

  assert.equal(result.ordersUpdated, 2);
  assert.equal(result.fillsInserted, 2);
  assert.equal(localOrders.get('o-1')?.status, 'filled');
  assert.equal(localOrders.get('o-2')?.status, 'expired');
});

test('EXEC-004: reprocessamento não deve duplicar fills (idempotência)', async () => {
  const seen = new Set<string>();

  const reconciler = new OrderReconciler({
    fetchRemoteOrders: async () => [{ orderId: 'o-1', status: 'partial' }],
    fetchRemoteFills: async () => [
      { fillId: 'f-dup', orderId: 'o-1', size: 2, price: 0.5 },
      { fillId: 'f-dup', orderId: 'o-1', size: 2, price: 0.5 }
    ],
    getLocalOrder: async () => ({ status: 'open' }),
    upsertLocalOrder: async () => undefined,
    hasLocalFill: async (fillId) => seen.has(fillId),
    persistLocalFill: async (fill) => {
      seen.add(fill.fillId);
    }
  });

  const first = await reconciler.reconcileOnce();
  const second = await reconciler.reconcileOnce();

  assert.equal(first.fillsInserted, 1);
  assert.equal(second.fillsInserted, 0);
});
