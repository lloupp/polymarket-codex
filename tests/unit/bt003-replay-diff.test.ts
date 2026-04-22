import test from 'node:test';
import assert from 'node:assert/strict';

import { compareReplayReports } from '../../src/runtime/replay-diff';
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
