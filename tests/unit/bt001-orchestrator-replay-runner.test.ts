import test from 'node:test';
import assert from 'node:assert/strict';

import { OrchestratorReplayRunner } from '../../src/runtime/orchestrator-replay-runner';

test('BT-001: replay baseline deve ser determinístico para mesmo cenário', async () => {
  const runner = new OrchestratorReplayRunner({
    runCycle: async ({ cycleId }) => ({
      cycleId,
      signalsReceived: 2,
      signalsAccepted: 2,
      signalsBlocked: 0,
      ordersSubmitted: 2,
      ordersFailed: 0,
      ordersFilled: 2,
      reconciliation: { ordersUpdated: 2, fillsInserted: 2 }
    })
  });

  const scenarios = [{ cycleId: 'c1' }, { cycleId: 'c2' }];

  const first = await runner.run({ scenarios });
  const second = await runner.run({ scenarios });

  assert.deepEqual(first.summary, second.summary);
  assert.equal(first.summary.failedCycles, 0);
  assert.equal(first.summary.ordersFilled, 4);
  assert.equal(typeof first.fingerprint, 'string');
  assert.equal(first.fingerprint.length > 0, true);
  assert.equal(first.fingerprint, second.fingerprint);
});

test('BT-002: fingerprint deve mudar quando resultado do replay muda', async () => {
  const runner = new OrchestratorReplayRunner({
    runCycle: async ({ cycleId }) => ({
      cycleId,
      signalsReceived: 1,
      signalsAccepted: 1,
      signalsBlocked: 0,
      ordersSubmitted: 1,
      ordersFailed: 0,
      ordersFilled: cycleId === 'c2' ? 0 : 1,
      reconciliation: { ordersUpdated: 1, fillsInserted: cycleId === 'c2' ? 0 : 1 }
    })
  });

  const baseline = await runner.run({ scenarios: [{ cycleId: 'c1' }, { cycleId: 'c3' }] });
  const changed = await runner.run({ scenarios: [{ cycleId: 'c1' }, { cycleId: 'c2' }] });

  assert.notEqual(baseline.fingerprint, changed.fingerprint);
});

test('BT-001: replay deve registrar incidente quando ciclo falha por erro injetado', async () => {
  const runner = new OrchestratorReplayRunner({
    runCycle: async ({ cycleId, injectExecutionError }) => {
      if (injectExecutionError) {
        throw new Error(`forced execution error @ ${cycleId}`);
      }

      return {
        cycleId,
        signalsReceived: 1,
        signalsAccepted: 1,
        signalsBlocked: 0,
        ordersSubmitted: 1,
        ordersFailed: 0,
        ordersFilled: 1,
        reconciliation: { ordersUpdated: 1, fillsInserted: 1 }
      };
    }
  });

  const report = await runner.run({
    scenarios: [
      { cycleId: 'c1' },
      { cycleId: 'c2', injectExecutionError: true },
      { cycleId: 'c3' }
    ]
  });

  assert.equal(report.summary.totalCycles, 3);
  assert.equal(report.summary.failedCycles, 1);
  assert.equal(report.summary.successfulCycles, 2);
  assert.equal(report.summary.ordersFilled, 2);
  assert.equal(report.incidents.length, 1);
  assert.equal(report.incidents[0]?.cycleId, 'c2');
  assert.match(report.incidents[0]?.message ?? '', /forced execution error/);
});
