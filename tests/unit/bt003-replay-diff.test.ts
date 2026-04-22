import test from 'node:test';
import assert from 'node:assert/strict';

import { compareReplayReports, evaluateReplayDrift } from '../../src/runtime/replay-diff';
import type { ReplayReport } from '../../src/runtime/orchestrator-replay-runner';

function makeReport(overrides: Partial<ReplayReport> = {}): ReplayReport {
  return {
    cycles: [],
    incidents: [],
    summary: {
      totalCycles: 3,
      successfulCycles: 3,
      failedCycles: 0,
      ordersSubmitted: 6,
      ordersFailed: 0,
      ordersFilled: 6,
      signalsAccepted: 6,
      signalsBlocked: 0
    },
    fingerprint: 'fp-baseline',
    ...overrides
  };
}

test('BT-003: deve marcar equivalente quando fingerprint é igual', () => {
  const baseline = makeReport();
  const candidate = makeReport({ fingerprint: 'fp-baseline' });

  const diff = compareReplayReports({ baseline, candidate });

  assert.equal(diff.equivalent, true);
  assert.equal(diff.summaryDiff.ordersFilledDelta, 0);
  assert.equal(diff.summaryDiff.failedCyclesDelta, 0);
});

test('BT-003: deve detalhar deltas quando fingerprint diverge', () => {
  const baseline = makeReport();
  const candidate = makeReport({
    fingerprint: 'fp-changed',
    summary: {
      ...baseline.summary,
      failedCycles: 1,
      ordersFilled: 5,
      ordersFailed: 1
    }
  });

  const diff = compareReplayReports({ baseline, candidate });

  assert.equal(diff.equivalent, false);
  assert.equal(diff.summaryDiff.failedCyclesDelta, 1);
  assert.equal(diff.summaryDiff.ordersFilledDelta, -1);
  assert.equal(diff.summaryDiff.ordersFailedDelta, 1);
});

test('BT-004: evaluator deve classificar stable quando deltas estiverem dentro do budget', () => {
  const baseline = makeReport();
  const candidate = makeReport({
    fingerprint: 'fp-different-but-close',
    summary: {
      ...baseline.summary,
      ordersFilled: 5,
      ordersFailed: 1
    }
  });

  const comparison = compareReplayReports({ baseline, candidate });
  const evaluated = evaluateReplayDrift({
    comparison,
    budget: {
      ordersFilledDelta: 1,
      ordersFailedDelta: 1
    }
  });

  assert.equal(evaluated.status, 'stable');
  assert.equal(evaluated.violations.length, 0);
  assert.equal(evaluated.warnings.some((warning) => warning.includes('fingerprint')), true);
});

test('BT-004: evaluator deve classificar drifted quando delta excede budget', () => {
  const baseline = makeReport();
  const candidate = makeReport({
    fingerprint: 'fp-drifted',
    summary: {
      ...baseline.summary,
      ordersFilled: 3,
      ordersFailed: 3
    }
  });

  const comparison = compareReplayReports({ baseline, candidate });
  const evaluated = evaluateReplayDrift({
    comparison,
    budget: {
      ordersFilledDelta: 1,
      ordersFailedDelta: 1
    }
  });

  assert.equal(evaluated.status, 'drifted');
  assert.equal(evaluated.violations.length > 0, true);
  assert.equal(evaluated.violations.some((violation) => violation.metric === 'ordersFilledDelta'), true);
});
