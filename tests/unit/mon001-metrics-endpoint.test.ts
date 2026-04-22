import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { createApp } from '../../src/app';
import { MetricsRegistry } from '../../src/monitoring/metrics-registry';

test('MON-001: deve calcular métricas operacionais incluindo fill-rate e edge capture', () => {
  const metrics = new MetricsRegistry();

  metrics.recordSignalAccepted();
  metrics.recordSignalAccepted();
  metrics.recordSignalBlocked();
  metrics.recordOrderSubmitted({ latencyMs: 120 });
  metrics.recordOrderSubmitted({ latencyMs: 180 });
  metrics.recordOrderFilled({ expectedEdge: 0.12, realizedEdge: 0.08 });

  const snapshot = metrics.snapshot();

  assert.equal(snapshot.signalsAccepted, 2);
  assert.equal(snapshot.signalsBlocked, 1);
  assert.equal(snapshot.ordersSubmitted, 2);
  assert.equal(snapshot.ordersFilled, 1);
  assert.equal(snapshot.fillRate, 0.5);
  assert.equal(snapshot.avgOrderLatencyMs, 150);
  assert.equal(snapshot.expectedEdgeTotal, 0.12);
  assert.equal(snapshot.realizedEdgeTotal, 0.08);
  assert.equal(snapshot.edgeCaptureRatio, 0.666667);
});

test('MON-001: endpoint /metrics deve expor métricas em formato prometheus', async () => {
  const metrics = new MetricsRegistry();
  metrics.recordSignalAccepted();
  metrics.recordSignalBlocked();
  metrics.recordOrderSubmitted({ latencyMs: 90 });
  metrics.recordOrderFilled({ expectedEdge: 0.1, realizedEdge: 0.09 });

  const app = createApp({ metrics });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type')?.includes('text/plain'), true);
  assert.equal(body.includes('polymarket_fill_rate 1'), true);
  assert.equal(body.includes('polymarket_order_latency_ms_avg 90'), true);
  assert.equal(body.includes('polymarket_signals_blocked_total 1'), true);
  assert.equal(body.includes('polymarket_realized_edge_total 0.09'), true);

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
