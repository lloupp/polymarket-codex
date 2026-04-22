import type { ReplayReport, ReplaySummary } from './orchestrator-replay-runner';

export type ReplaySummaryDiff = {
  totalCyclesDelta: number;
  successfulCyclesDelta: number;
  failedCyclesDelta: number;
  ordersSubmittedDelta: number;
  ordersFailedDelta: number;
  ordersFilledDelta: number;
  signalsAcceptedDelta: number;
  signalsBlockedDelta: number;
};

export type ReplayComparison = {
  equivalent: boolean;
  baselineFingerprint: string;
  candidateFingerprint: string;
  summaryDiff: ReplaySummaryDiff;
};

export type ReplayDriftBudget = Partial<Record<keyof ReplaySummaryDiff, number>>;

export type ReplayDriftViolation = {
  metric: keyof ReplaySummaryDiff;
  delta: number;
  budget: number;
};

export type ReplayDriftEvaluation = {
  status: 'stable' | 'drifted';
  violations: ReplayDriftViolation[];
  warnings: string[];
  driftScore: number;
};

function diffSummary(baseline: ReplaySummary, candidate: ReplaySummary): ReplaySummaryDiff {
  return {
    totalCyclesDelta: candidate.totalCycles - baseline.totalCycles,
    successfulCyclesDelta: candidate.successfulCycles - baseline.successfulCycles,
    failedCyclesDelta: candidate.failedCycles - baseline.failedCycles,
    ordersSubmittedDelta: candidate.ordersSubmitted - baseline.ordersSubmitted,
    ordersFailedDelta: candidate.ordersFailed - baseline.ordersFailed,
    ordersFilledDelta: candidate.ordersFilled - baseline.ordersFilled,
    signalsAcceptedDelta: candidate.signalsAccepted - baseline.signalsAccepted,
    signalsBlockedDelta: candidate.signalsBlocked - baseline.signalsBlocked
  };
}

export function compareReplayReports(input: {
  baseline: ReplayReport;
  candidate: ReplayReport;
}): ReplayComparison {
  const summaryDiff = diffSummary(input.baseline.summary, input.candidate.summary);

  return {
    equivalent: input.baseline.fingerprint === input.candidate.fingerprint,
    baselineFingerprint: input.baseline.fingerprint,
    candidateFingerprint: input.candidate.fingerprint,
    summaryDiff
  };
}

export function evaluateReplayDrift(input: {
  comparison: ReplayComparison;
  budget: ReplayDriftBudget;
}): ReplayDriftEvaluation {
  const violations: ReplayDriftViolation[] = [];

  let driftScore = 0;

  for (const [metric, budgetValue] of Object.entries(input.budget) as Array<
    [keyof ReplaySummaryDiff, number | undefined]
  >) {
    if (budgetValue === undefined) {
      continue;
    }

    const allowed = Math.max(0, budgetValue);
    const delta = input.comparison.summaryDiff[metric];
    const normalized = Math.abs(delta) / Math.max(1, allowed);
    driftScore += normalized;

    if (Math.abs(delta) > allowed) {
      violations.push({ metric, delta, budget: allowed });
    }
  }

  const warnings: string[] = [];
  if (!input.comparison.equivalent) {
    warnings.push('fingerprint mismatch between baseline and candidate');
  }

  return {
    status: violations.length === 0 ? 'stable' : 'drifted',
    violations,
    warnings,
    driftScore
  };
}

export function isReplayWithinGate(input: {
  comparison: ReplayComparison;
  budget: ReplayDriftBudget;
  maxDriftScore: number;
}): ReplayDriftEvaluation & { accepted: boolean } {
  const evaluation = evaluateReplayDrift({
    comparison: input.comparison,
    budget: input.budget
  });

  return {
    ...evaluation,
    accepted: evaluation.driftScore <= Math.max(0, input.maxDriftScore)
  };
}
