import test from 'node:test';
import assert from 'node:assert/strict';

import { AlertingService } from '../../src/monitoring/alerting';
import { SloEvaluator } from '../../src/monitoring/slo-evaluator';

function buildEvaluator(alerts: Array<Record<string, unknown>>) {
  const alerting = new AlertingService({
    send: async (payload) => {
      alerts.push(payload as unknown as Record<string, unknown>);
    }
  });

  return new SloEvaluator({
    thresholds: {
      errorRateWarning: 0.2,
      errorRateCritical: 0.4,
      latencyMsWarning: 1500,
      latencyMsCritical: 3000,
      staleModulesWarning: 1,
      staleModulesCritical: 2
    },
    holdDownEvaluations: 2,
    repeatAlertEveryEvaluations: 3,
    alerting
  });
}

test('MON-004: deve classificar SLO em ok/degraded/critical', async () => {
  const alerts: Array<Record<string, unknown>> = [];
  const evaluator = buildEvaluator(alerts);

  const ok = await evaluator.evaluate({
    signalsAccepted: 10,
    signalsBlocked: 1,
    ordersSubmitted: 10,
    ordersFilled: 9,
    fillRate: 0.9,
    avgOrderLatencyMs: 500,
    expectedEdgeTotal: 1,
    realizedEdgeTotal: 0.8,
    edgeCaptureRatio: 0.8,
    staleModulesTotal: 0,
    moduleHealth: []
  });

  const degraded = await evaluator.evaluate({
    signalsAccepted: 10,
    signalsBlocked: 1,
    ordersSubmitted: 10,
    ordersFilled: 7,
    fillRate: 0.7,
    avgOrderLatencyMs: 1200,
    expectedEdgeTotal: 1,
    realizedEdgeTotal: 0.8,
    edgeCaptureRatio: 0.8,
    staleModulesTotal: 1,
    moduleHealth: []
  });

  const critical = await evaluator.evaluate({
    signalsAccepted: 10,
    signalsBlocked: 1,
    ordersSubmitted: 10,
    ordersFilled: 4,
    fillRate: 0.4,
    avgOrderLatencyMs: 3500,
    expectedEdgeTotal: 1,
    realizedEdgeTotal: 0.8,
    edgeCaptureRatio: 0.8,
    staleModulesTotal: 2,
    moduleHealth: []
  });

  assert.equal(ok.status, 'ok');
  assert.equal(degraded.status, 'degraded');
  assert.equal(critical.status, 'critical');
});

test('MON-004: deve aplicar histerese para reduzir alert storm', async () => {
  const alerts: Array<Record<string, unknown>> = [];
  const evaluator = buildEvaluator(alerts);

  const snapshot = {
    signalsAccepted: 10,
    signalsBlocked: 1,
    ordersSubmitted: 10,
    ordersFilled: 7,
    fillRate: 0.7,
    avgOrderLatencyMs: 1600,
    expectedEdgeTotal: 1,
    realizedEdgeTotal: 0.8,
    edgeCaptureRatio: 0.8,
    staleModulesTotal: 1,
    moduleHealth: []
  };

  const first = await evaluator.evaluate(snapshot);
  const second = await evaluator.evaluate(snapshot);
  const third = await evaluator.evaluate(snapshot);
  const fourth = await evaluator.evaluate(snapshot);
  const fifth = await evaluator.evaluate(snapshot);

  assert.equal(first.shouldAlert, false);
  assert.equal(second.shouldAlert, true);
  assert.equal(third.shouldAlert, false);
  assert.equal(fourth.shouldAlert, false);
  assert.equal(fifth.shouldAlert, true);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0]?.incidentType, 'slo_degradation');
});
