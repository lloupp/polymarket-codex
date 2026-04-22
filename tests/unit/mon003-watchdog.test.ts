import test from 'node:test';
import assert from 'node:assert/strict';

import { AlertingService } from '../../src/monitoring/alerting';
import { MetricsRegistry } from '../../src/monitoring/metrics-registry';
import { MonitoringWatchdog } from '../../src/monitoring/watchdog';

test('MON-003: watchdog deve marcar módulo stale e emitir alerta', async () => {
  const alerts: Array<{ incidentType: string; context: Record<string, unknown> }> = [];
  const alerting = new AlertingService({
    send: async (payload) => {
      alerts.push({ incidentType: payload.incidentType, context: payload.context });
    }
  });

  const metrics = new MetricsRegistry();

  const watchdog = new MonitoringWatchdog({
    modules: [
      { module: 'stream', staleAfterMs: 5_000, incidentType: 'ws_down' },
      { module: 'poll', staleAfterMs: 3_000, incidentType: 'staleness' }
    ],
    metrics,
    alerting,
    repeatAlertEveryMs: 4_000,
    now: () => 10_000
  });

  watchdog.heartbeat('stream', { timestampMs: 9_000 });
  watchdog.heartbeat('poll', { timestampMs: 9_500 });

  const healthy = await watchdog.evaluate({ timestampMs: 11_000 });
  assert.equal(healthy.staleModules.length, 0);

  const stale = await watchdog.evaluate({ timestampMs: 14_000 });
  assert.deepEqual(stale.staleModules.sort(), ['poll']);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.incidentType, 'staleness');
  assert.equal(alerts[0]?.context.module, 'poll');

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.staleModulesTotal, 1);
  const pollHealth = snapshot.moduleHealth.find((module) => module.module === 'poll');
  assert.equal(pollHealth?.stale, true);
  assert.equal((pollHealth?.heartbeatAgeMs ?? 0) > 3000, true);
});

test('MON-003: watchdog deve alertar novamente em staleness prolongado após janela de repetição', async () => {
  const alerts: number[] = [];
  const alerting = new AlertingService({
    send: async () => {
      alerts.push(Date.now());
    }
  });

  const metrics = new MetricsRegistry();
  const watchdog = new MonitoringWatchdog({
    modules: [{ module: 'reconciliation', staleAfterMs: 1_000, incidentType: 'staleness' }],
    metrics,
    alerting,
    repeatAlertEveryMs: 2_000
  });

  watchdog.heartbeat('reconciliation', { timestampMs: 0 });

  await watchdog.evaluate({ timestampMs: 1_500 });
  await watchdog.evaluate({ timestampMs: 2_000 });
  await watchdog.evaluate({ timestampMs: 3_600 });

  assert.equal(alerts.length, 2);

  const prometheus = metrics.toPrometheus();
  assert.equal(prometheus.includes('polymarket_stale_modules_total 1'), true);
  assert.equal(prometheus.includes('polymarket_module_stale{module="reconciliation"} 1'), true);
});
