import { createHash } from 'node:crypto';

import type { CycleResult } from './execution-orchestrator';

export type ReplayScenario = {
  cycleId: string;
  injectExecutionError?: boolean;
};

export type ReplayIncident = {
  cycleId: string;
  type: 'cycle_error';
  message: string;
};

export type ReplaySummary = {
  totalCycles: number;
  successfulCycles: number;
  failedCycles: number;
  ordersSubmitted: number;
  ordersFailed: number;
  ordersFilled: number;
  signalsAccepted: number;
  signalsBlocked: number;
};

export type ReplayReport = {
  cycles: Array<CycleResult & { status: 'ok' | 'failed' }>;
  incidents: ReplayIncident[];
  summary: ReplaySummary;
  fingerprint: string;
};

export type OrchestratorReplayRunnerConfig = {
  runCycle: (input: { cycleId: string; injectExecutionError?: boolean }) => Promise<CycleResult>;
};

export class OrchestratorReplayRunner {
  private readonly config: OrchestratorReplayRunnerConfig;

  constructor(config: OrchestratorReplayRunnerConfig) {
    this.config = config;
  }

  async run(input: { scenarios: ReplayScenario[] }): Promise<ReplayReport> {
    const cycles: Array<CycleResult & { status: 'ok' | 'failed' }> = [];
    const incidents: ReplayIncident[] = [];

    for (const scenario of input.scenarios) {
      try {
        const result = await this.config.runCycle({
          cycleId: scenario.cycleId,
          injectExecutionError: scenario.injectExecutionError
        });

        cycles.push({ ...result, status: 'ok' });
      } catch (error) {
        incidents.push({
          cycleId: scenario.cycleId,
          type: 'cycle_error',
          message: error instanceof Error ? error.message : String(error)
        });

        cycles.push({
          cycleId: scenario.cycleId,
          signalsReceived: 0,
          signalsAccepted: 0,
          signalsBlocked: 0,
          ordersSubmitted: 0,
          ordersFailed: 0,
          ordersFilled: 0,
          reconciliation: { ordersUpdated: 0, fillsInserted: 0 },
          status: 'failed'
        });
      }
    }

    const summary = cycles.reduce<ReplaySummary>(
      (acc, cycle) => {
        acc.totalCycles += 1;
        if (cycle.status === 'ok') {
          acc.successfulCycles += 1;
        } else {
          acc.failedCycles += 1;
        }

        acc.ordersSubmitted += cycle.ordersSubmitted;
        acc.ordersFailed += cycle.ordersFailed;
        acc.ordersFilled += cycle.ordersFilled;
        acc.signalsAccepted += cycle.signalsAccepted;
        acc.signalsBlocked += cycle.signalsBlocked;
        return acc;
      },
      {
        totalCycles: 0,
        successfulCycles: 0,
        failedCycles: 0,
        ordersSubmitted: 0,
        ordersFailed: 0,
        ordersFilled: 0,
        signalsAccepted: 0,
        signalsBlocked: 0
      }
    );

    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          cycles,
          incidents,
          summary
        })
      )
      .digest('hex');

    return {
      cycles,
      incidents,
      summary,
      fingerprint
    };
  }
}
