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
