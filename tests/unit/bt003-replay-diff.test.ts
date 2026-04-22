import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareReplayReports,
  evaluateReplayDrift,
  evaluateReplayGateDecision,
  formatReplayGateSummary,
  isReplayWithinGate
} from '../../src/runtime/replay-diff';
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

test('BT-005: evaluator deve expor driftScore agregado normalizado', () => {
  const baseline = makeReport();
  const candidate = makeReport({
    fingerprint: 'fp-drift-score',
    summary: {
      ...baseline.summary,
      ordersFilled: 4,
      ordersFailed: 2
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
  assert.equal(evaluated.driftScore, 4);
});

test('BT-005: gate numérico deve aprovar/reprovar com base no maxDriftScore', () => {
  const baseline = makeReport();
  const candidate = makeReport({
    fingerprint: 'fp-gate',
    summary: {
      ...baseline.summary,
      ordersFilled: 5,
      ordersFailed: 1
    }
  });

  const comparison = compareReplayReports({ baseline, candidate });

  const passGate = isReplayWithinGate({
    comparison,
    budget: {
      ordersFilledDelta: 1,
      ordersFailedDelta: 1
    },
    maxDriftScore: 2
  });

  const failGate = isReplayWithinGate({
    comparison,
    budget: {
      ordersFilledDelta: 1,
      ordersFailedDelta: 1
    },
    maxDriftScore: 0.5
  });

  assert.equal(passGate.accepted, true);
  assert.equal(passGate.driftScore, 2);
  assert.equal(failGate.accepted, false);
  assert.equal(failGate.driftScore, 2);
});

test('BT-006: gate decision deve classificar severity=pass com razão determinística', () => {
  const baseline = makeReport();
  const candidate = makeReport();

  const comparison = compareReplayReports({ baseline, candidate });
  const decision = evaluateReplayGateDecision({
    comparison,
    budget: {
      ordersFilledDelta: 1,
      ordersFailedDelta: 1
    },
    maxDriftScore: 2,
    warnDriftScore: 1
  });

  assert.equal(decision.accepted, true);
  assert.equal(decision.severity, 'pass');
  assert.equal(decision.reason, 'stable_and_within_threshold');
});

test('BT-006: gate decision deve classificar severity=warn quando driftScore ultrapassa warn', () => {
  const baseline = makeReport();
  const candidate = makeReport({
    fingerprint: 'fp-warn',
    summary: {
      ...baseline.summary,
      ordersFilled: 5,
      ordersFailed: 1
    }
  });

  const comparison = compareReplayReports({ baseline, candidate });
  const decision = evaluateReplayGateDecision({
    comparison,
    budget: {
      ordersFilledDelta: 1,
      ordersFailedDelta: 1
    },
    maxDriftScore: 3,
    warnDriftScore: 1
  });

  assert.equal(decision.accepted, true);
  assert.equal(decision.severity, 'warn');
  assert.equal(decision.reason, 'within_max_but_above_warn_threshold');
});

test('BT-006: gate decision deve classificar severity=fail quando driftScore excede max', () => {
  const baseline = makeReport();
  const candidate = makeReport({
    fingerprint: 'fp-fail',
    summary: {
      ...baseline.summary,
      ordersFilled: 2,
      ordersFailed: 4
    }
  });

  const comparison = compareReplayReports({ baseline, candidate });
  const decision = evaluateReplayGateDecision({
    comparison,
    budget: {
      ordersFilledDelta: 1,
      ordersFailedDelta: 1
    },
    maxDriftScore: 3,
    warnDriftScore: 1
  });

  assert.equal(decision.accepted, false);
  assert.equal(decision.severity, 'fail');
  assert.equal(decision.reason, 'drift_score_exceeded_max_threshold');
});

test('BT-007: formatReplayGateSummary deve gerar saída determinística para pass/warn/fail', () => {
  const stableDecision = evaluateReplayGateDecision({
    comparison: compareReplayReports({ baseline: makeReport(), candidate: makeReport() }),
    budget: {
      ordersFilledDelta: 1,
      ordersFailedDelta: 1
    },
    maxDriftScore: 2,
    warnDriftScore: 1
  });

  const warnDecision = evaluateReplayGateDecision({
    comparison: compareReplayReports({
      baseline: makeReport(),
      candidate: makeReport({
        fingerprint: 'fp-warn-summary',
        summary: {
          ...makeReport().summary,
          ordersFilled: 5,
          ordersFailed: 1
        }
      })
    }),
    budget: {
      ordersFilledDelta: 1,
      ordersFailedDelta: 1
    },
    maxDriftScore: 3,
    warnDriftScore: 1
  });

  const failDecision = evaluateReplayGateDecision({
    comparison: compareReplayReports({
      baseline: makeReport(),
      candidate: makeReport({
        fingerprint: 'fp-fail-summary',
        summary: {
          ...makeReport().summary,
          ordersFilled: 2,
          ordersFailed: 4
        }
      })
    }),
    budget: {
      ordersFilledDelta: 1,
      ordersFailedDelta: 1
    },
    maxDriftScore: 3,
    warnDriftScore: 1
  });

  assert.equal(
    formatReplayGateSummary(stableDecision),
    'severity=pass accepted=true reason=stable_and_within_threshold driftScore=0.000 violations=0 warnings=0'
  );
  assert.equal(
    formatReplayGateSummary(warnDecision),
    'severity=warn accepted=true reason=within_max_but_above_warn_threshold driftScore=2.000 violations=0 warnings=1'
  );
  assert.equal(
    formatReplayGateSummary(failDecision),
    'severity=fail accepted=false reason=drift_score_exceeded_max_threshold driftScore=8.000 violations=2 warnings=1'
  );
});
