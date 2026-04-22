import type { AlertingService } from './alerting';
import type { MetricsSnapshot } from './metrics-registry';

export type SloStatus = 'ok' | 'degraded' | 'critical';

export type SloThresholds = {
  errorRateWarning: number;
  errorRateCritical: number;
  latencyMsWarning: number;
  latencyMsCritical: number;
  staleModulesWarning: number;
  staleModulesCritical: number;
};

export type SloEvaluatorConfig = {
  thresholds: SloThresholds;
  holdDownEvaluations?: number;
  repeatAlertEveryEvaluations?: number;
  alerting?: AlertingService;
};

export type SloEvaluation = {
  status: SloStatus;
  shouldAlert: boolean;
  reasons: string[];
  breachStreak: number;
  metrics: {
    errorRate: number;
    avgOrderLatencyMs: number;
    staleModulesTotal: number;
  };
};

function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export class SloEvaluator {
  private readonly config: SloEvaluatorConfig;
  private breachStreak = 0;
  private evalCount = 0;
  private lastAlertedStatus: SloStatus | null = null;
  private lastAlertEvaluation = 0;

  constructor(config: SloEvaluatorConfig) {
    this.config = {
      ...config,
      holdDownEvaluations: config.holdDownEvaluations ?? 2,
      repeatAlertEveryEvaluations: config.repeatAlertEveryEvaluations ?? 4
    };
  }

  async evaluate(metrics: MetricsSnapshot): Promise<SloEvaluation> {
    this.evalCount += 1;

    const errorRate = metrics.ordersSubmitted === 0 ? 0 : 1 - metrics.fillRate;
    const reasons: string[] = [];

    const status = this.computeStatus({
      errorRate,
      avgOrderLatencyMs: metrics.avgOrderLatencyMs,
      staleModulesTotal: metrics.staleModulesTotal,
      reasons
    });

    if (status === 'ok') {
      this.breachStreak = 0;
    } else {
      this.breachStreak += 1;
    }

    const shouldAlert = this.shouldAlert(status);

    if (shouldAlert && this.config.alerting) {
      await this.config.alerting.notify({
        incidentType: 'slo_degradation',
        message: `SLO status ${status}`,
        context: {
          reasons: reasons.join('; '),
          errorRate: round(errorRate),
          avgOrderLatencyMs: metrics.avgOrderLatencyMs,
          staleModulesTotal: metrics.staleModulesTotal,
          breachStreak: this.breachStreak
        }
      });
    }

    if (shouldAlert) {
      this.lastAlertedStatus = status;
      this.lastAlertEvaluation = this.evalCount;
    }

    return {
      status,
      shouldAlert,
      reasons,
      breachStreak: this.breachStreak,
      metrics: {
        errorRate: round(errorRate),
        avgOrderLatencyMs: metrics.avgOrderLatencyMs,
        staleModulesTotal: metrics.staleModulesTotal
      }
    };
  }

  private computeStatus(input: {
    errorRate: number;
    avgOrderLatencyMs: number;
    staleModulesTotal: number;
    reasons: string[];
  }): SloStatus {
    const t = this.config.thresholds;

    const criticalBreaches: string[] = [];
    const degradedBreaches: string[] = [];

    if (input.errorRate >= t.errorRateCritical) {
      criticalBreaches.push(`error_rate>=${t.errorRateCritical}`);
    } else if (input.errorRate >= t.errorRateWarning) {
      degradedBreaches.push(`error_rate>=${t.errorRateWarning}`);
    }

    if (input.avgOrderLatencyMs >= t.latencyMsCritical) {
      criticalBreaches.push(`latency_ms>=${t.latencyMsCritical}`);
    } else if (input.avgOrderLatencyMs >= t.latencyMsWarning) {
      degradedBreaches.push(`latency_ms>=${t.latencyMsWarning}`);
    }

    if (input.staleModulesTotal >= t.staleModulesCritical) {
      criticalBreaches.push(`stale_modules>=${t.staleModulesCritical}`);
    } else if (input.staleModulesTotal >= t.staleModulesWarning) {
      degradedBreaches.push(`stale_modules>=${t.staleModulesWarning}`);
    }

    if (criticalBreaches.length > 0) {
      input.reasons.push(...criticalBreaches);
      return 'critical';
    }

    if (degradedBreaches.length > 0) {
      input.reasons.push(...degradedBreaches);
      return 'degraded';
    }

    return 'ok';
  }

  private shouldAlert(status: SloStatus): boolean {
    if (status === 'ok') {
      return false;
    }

    if (this.breachStreak < (this.config.holdDownEvaluations ?? 2)) {
      return false;
    }

    if (this.lastAlertedStatus !== status) {
      return true;
    }

    return this.evalCount - this.lastAlertEvaluation >= (this.config.repeatAlertEveryEvaluations ?? 4);
  }
}
