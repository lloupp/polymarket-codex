import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { createApp } from '../../src/app';
import { RuntimeStateStore } from '../../src/runtime/state-store';

test('CORE-001: state store deve manter snapshot atômico e expor leitura consistente', async () => {
  const store = new RuntimeStateStore();

  await store.updateState({
    signals: [{ signalId: 's1', strategy: 'neg-risk-arb', marketId: 'm1' }],
    orders: [{ orderId: 'o1', marketId: 'm1', status: 'open' }],
    positions: [{ marketId: 'm1', tokenId: 'yes', size: 12, avgPrice: 0.54 }],
    risk: { breaker: { tripped: false }, status: 'ok' }
  });

  const snapshot = await store.getSnapshot();

  assert.equal(snapshot.signals.length, 1);
  assert.equal(snapshot.orders.length, 1);
  assert.equal(snapshot.positions.length, 1);
  assert.equal(snapshot.risk.breaker.tripped, false);

  await store.updateState({
    orders: [{ orderId: 'o2', marketId: 'm1', status: 'filled' }],
    risk: { breaker: { tripped: true, reason: 'consecutive_errors' }, status: 'paused' }
  });

  const nextSnapshot = await store.getSnapshot();

  assert.equal(nextSnapshot.orders[0]?.orderId, 'o2');
  assert.equal(nextSnapshot.risk.status, 'paused');
  assert.equal(nextSnapshot.signals[0]?.signalId, 's1');
});

test('CORE-001: API operacional deve refletir estado real do runtime store', async () => {
  const store = new RuntimeStateStore();

  await store.updateState({
    signals: [{ signalId: 's9', strategy: 'neg-risk-arb', marketId: 'm9', edge: 0.07 }],
    orders: [{ orderId: 'o9', marketId: 'm9', side: 'BUY', status: 'open' }],
    positions: [{ marketId: 'm9', tokenId: 'yes', size: 30, avgPrice: 0.49 }],
    risk: { breaker: { tripped: true, reason: 'daily_drawdown' }, status: 'paused' }
  });

  const app = createApp({ stateStore: store });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const [positions, orders, signals, risk] = await Promise.all([
    fetch(`${baseUrl}/positions`).then((response) => response.json()),
    fetch(`${baseUrl}/orders`).then((response) => response.json()),
    fetch(`${baseUrl}/signals`).then((response) => response.json()),
    fetch(`${baseUrl}/risk`).then((response) => response.json())
  ]);

  assert.equal(positions.positions[0]?.marketId, 'm9');
  assert.equal(orders.orders[0]?.orderId, 'o9');
  assert.equal(signals.signals[0]?.signalId, 's9');
  assert.equal(risk.risk.breaker.reason, 'daily_drawdown');

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});
