import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { createApp } from '../../src/app';

test('API-001: deve responder /health, /positions, /orders, /signals e /risk', async () => {
  const app = createApp({
    startedAt: new Date(Date.now() - 12_000),
    provider: {
      getPositions: async () => [
        { marketId: 'm1', tokenId: 'yes', size: 100, avgPrice: 0.52 },
        { marketId: 'm2', tokenId: 'no', size: 55, avgPrice: 0.44 }
      ],
      getOrders: async () => [
        { orderId: 'o1', marketId: 'm1', side: 'BUY', status: 'open' },
        { orderId: 'o2', marketId: 'm2', side: 'SELL', status: 'filled' }
      ],
      getSignals: async () => [
        { strategy: 'neg-risk-arb', marketId: 'm1', side: 'BUY', edge: 0.08 },
        { strategy: 'neg-risk-arb', marketId: 'm2', side: 'SELL', edge: 0.06 }
      ],
      getRisk: async () => ({
        breaker: { tripped: true, reason: 'daily_drawdown' },
        limits: { maxTradeNotional: 100, maxGlobalNotional: 1000 },
        status: 'paused'
      })
    }
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  const positions = await fetch(`${baseUrl}/positions`).then((response) => response.json());
  const orders = await fetch(`${baseUrl}/orders`).then((response) => response.json());
  const signals = await fetch(`${baseUrl}/signals`).then((response) => response.json());
  const risk = await fetch(`${baseUrl}/risk`).then((response) => response.json());

  assert.equal(health.status, 'ok');
  assert.equal(typeof health.uptimeSec, 'number');
  assert.equal(health.uptimeSec >= 10, true);

  assert.equal(Array.isArray(positions.positions), true);
  assert.equal(positions.positions.length, 2);

  assert.equal(Array.isArray(orders.orders), true);
  assert.equal(orders.orders[0]?.orderId, 'o1');

  assert.equal(Array.isArray(signals.signals), true);
  assert.equal(signals.signals[1]?.marketId, 'm2');

  assert.equal(risk.risk.status, 'paused');
  assert.equal(risk.risk.breaker.tripped, true);

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

test('API-001: deve retornar 500 estruturado quando provider falha', async () => {
  const app = createApp({
    provider: {
      getPositions: async () => {
        throw new Error('db unavailable');
      }
    }
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/positions`);
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.error, 'internal_error');
  assert.equal(body.message, 'db unavailable');

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
