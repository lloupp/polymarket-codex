import type { AlertingService, IncidentType } from './alerting';
import type { MetricsRegistry } from './metrics-registry';

export type WatchdogModuleConfig = {
  module: string;
  staleAfterMs: number;
  incidentType?: IncidentType;
};

export type WatchdogConfig = {
  modules: WatchdogModuleConfig[];
  metrics: MetricsRegistry;
  alerting?: AlertingService;
  repeatAlertEveryMs?: number;
  now?: () => number;
};

type ModuleState = {
  lastHeartbeatMs: number | null;
  isStale: boolean;
  lastAlertMs: number | null;
};

export type ModuleEvaluation = {
  module: string;
  heartbeatAgeMs: number;
  stale: boolean;
  staleAfterMs: number;
};

export type WatchdogEvaluationResult = {
  evaluatedAt: string;
  staleModules: string[];
  modules: ModuleEvaluation[];
};

export class MonitoringWatchdog {
  private readonly config: WatchdogConfig;
  private readonly state = new Map<string, ModuleState>();

  constructor(config: WatchdogConfig) {
    this.config = config;

    for (const moduleConfig of this.config.modules) {
      this.state.set(moduleConfig.module, {
        lastHeartbeatMs: null,
        isStale: false,
        lastAlertMs: null
      });
    }
  }

  heartbeat(module: string, input: { timestampMs?: number } = {}): void {
    const nowMs = input.timestampMs ?? this.now();
    const current = this.state.get(module) ?? {
      lastHeartbeatMs: null,
      isStale: false,
      lastAlertMs: null
    };

    this.state.set(module, {
      ...current,
      lastHeartbeatMs: nowMs,
      isStale: false
    });

    this.config.metrics.updateModuleHealth({
      module,
      heartbeatAgeMs: 0,
      stale: false
    });
  }

  async evaluate(input: { timestampMs?: number } = {}): Promise<WatchdogEvaluationResult> {
    const nowMs = input.timestampMs ?? this.now();
    const modules: ModuleEvaluation[] = [];

    for (const moduleConfig of this.config.modules) {
      const current = this.state.get(moduleConfig.module) ?? {
        lastHeartbeatMs: null,
        isStale: false,
        lastAlertMs: null
      };

      const heartbeatAgeMs =
        current.lastHeartbeatMs === null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - current.lastHeartbeatMs);
      const stale = heartbeatAgeMs > moduleConfig.staleAfterMs;

      this.config.metrics.updateModuleHealth({
        module: moduleConfig.module,
        heartbeatAgeMs,
        stale
      });

      if (stale) {
        await this.maybeAlert(moduleConfig, current, heartbeatAgeMs, nowMs);
      }

      this.state.set(moduleConfig.module, {
        lastHeartbeatMs: current.lastHeartbeatMs,
        isStale: stale,
        lastAlertMs: stale ? (this.state.get(moduleConfig.module)?.lastAlertMs ?? current.lastAlertMs) : null
      });

      modules.push({
        module: moduleConfig.module,
        heartbeatAgeMs,
        stale,
        staleAfterMs: moduleConfig.staleAfterMs
      });
    }

    return {
      evaluatedAt: new Date(nowMs).toISOString(),
      staleModules: modules.filter((module) => module.stale).map((module) => module.module),
      modules
    };
  }

  private async maybeAlert(
    moduleConfig: WatchdogModuleConfig,
    state: ModuleState,
    heartbeatAgeMs: number,
    nowMs: number
  ): Promise<void> {
    const repeatAlertEveryMs = this.config.repeatAlertEveryMs ?? moduleConfig.staleAfterMs;
    const shouldAlert = !state.isStale || state.lastAlertMs === null || nowMs - state.lastAlertMs >= repeatAlertEveryMs;

    if (!shouldAlert || !this.config.alerting) {
      return;
    }

    await this.config.alerting.notify({
      incidentType: moduleConfig.incidentType ?? 'staleness',
      message: `Watchdog detectou staleness no módulo '${moduleConfig.module}'`,
      context: {
        module: moduleConfig.module,
        heartbeatAgeMs,
        staleAfterMs: moduleConfig.staleAfterMs
      },
      timestamp: new Date(nowMs).toISOString()
    });

    const nextState = this.state.get(moduleConfig.module) ?? state;
    nextState.lastAlertMs = nowMs;
    this.state.set(moduleConfig.module, nextState);
  }

  private now(): number {
    return this.config.now ? this.config.now() : Date.now();
  }
}
