export type ModuleHealthSnapshot = {
  module: string;
  heartbeatAgeMs: number;
  stale: boolean;
};

export type MetricsSnapshot = {
  signalsAccepted: number;
  signalsBlocked: number;
  ordersSubmitted: number;
  ordersFilled: number;
  fillRate: number;
  avgOrderLatencyMs: number;
  expectedEdgeTotal: number;
  realizedEdgeTotal: number;
  edgeCaptureRatio: number;
  staleModulesTotal: number;
  moduleHealth: ModuleHealthSnapshot[];
};

function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function sanitizeLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

export class MetricsRegistry {
  private signalsAccepted = 0;
  private signalsBlocked = 0;
  private ordersSubmitted = 0;
  private ordersFilled = 0;
  private latencySamples: number[] = [];
  private expectedEdgeTotal = 0;
  private realizedEdgeTotal = 0;
  private readonly moduleHealth = new Map<string, { heartbeatAgeMs: number; stale: boolean }>();

  recordSignalAccepted(): void {
    this.signalsAccepted += 1;
  }

  recordSignalBlocked(): void {
    this.signalsBlocked += 1;
  }

  recordOrderSubmitted(input: { latencyMs: number }): void {
    this.ordersSubmitted += 1;
    this.latencySamples.push(round(input.latencyMs));
  }

  recordOrderFilled(input: { expectedEdge: number; realizedEdge: number }): void {
    this.ordersFilled += 1;
    this.expectedEdgeTotal += input.expectedEdge;
    this.realizedEdgeTotal += input.realizedEdge;
  }

  updateModuleHealth(input: { module: string; heartbeatAgeMs: number; stale: boolean }): void {
    this.moduleHealth.set(input.module, {
      heartbeatAgeMs: round(Math.max(0, input.heartbeatAgeMs), 3),
      stale: input.stale
    });
  }

  snapshot(): MetricsSnapshot {
    const avgLatency =
      this.latencySamples.length === 0
        ? 0
        : this.latencySamples.reduce((sum, value) => sum + value, 0) / this.latencySamples.length;

    const fillRate = this.ordersSubmitted === 0 ? 0 : this.ordersFilled / this.ordersSubmitted;
    const edgeCaptureRatio =
      this.expectedEdgeTotal === 0 ? 0 : this.realizedEdgeTotal / this.expectedEdgeTotal;

    const moduleHealth: ModuleHealthSnapshot[] = Array.from(this.moduleHealth.entries())
      .map(([module, value]) => ({
        module,
        heartbeatAgeMs: value.heartbeatAgeMs,
        stale: value.stale
      }))
      .sort((a, b) => a.module.localeCompare(b.module));

    const staleModulesTotal = moduleHealth.filter((module) => module.stale).length;

    return {
      signalsAccepted: this.signalsAccepted,
      signalsBlocked: this.signalsBlocked,
      ordersSubmitted: this.ordersSubmitted,
      ordersFilled: this.ordersFilled,
      fillRate: round(fillRate),
      avgOrderLatencyMs: round(avgLatency),
      expectedEdgeTotal: round(this.expectedEdgeTotal),
      realizedEdgeTotal: round(this.realizedEdgeTotal),
      edgeCaptureRatio: round(edgeCaptureRatio),
      staleModulesTotal,
      moduleHealth
    };
  }

  toPrometheus(): string {
    const metrics = this.snapshot();

    const moduleMetrics = metrics.moduleHealth.flatMap((module) => {
      const label = sanitizeLabel(module.module);
      return [
        `polymarket_module_heartbeat_age_ms{module="${label}"} ${module.heartbeatAgeMs}`,
        `polymarket_module_stale{module="${label}"} ${module.stale ? 1 : 0}`
      ];
    });

    return [
      '# HELP polymarket_signals_accepted_total Total accepted signals',
      '# TYPE polymarket_signals_accepted_total counter',
      `polymarket_signals_accepted_total ${metrics.signalsAccepted}`,
      '# HELP polymarket_signals_blocked_total Total blocked signals',
      '# TYPE polymarket_signals_blocked_total counter',
      `polymarket_signals_blocked_total ${metrics.signalsBlocked}`,
      '# HELP polymarket_orders_submitted_total Total submitted orders',
      '# TYPE polymarket_orders_submitted_total counter',
      `polymarket_orders_submitted_total ${metrics.ordersSubmitted}`,
      '# HELP polymarket_orders_filled_total Total filled orders',
      '# TYPE polymarket_orders_filled_total counter',
      `polymarket_orders_filled_total ${metrics.ordersFilled}`,
      '# HELP polymarket_fill_rate Fill rate for submitted orders',
      '# TYPE polymarket_fill_rate gauge',
      `polymarket_fill_rate ${metrics.fillRate}`,
      '# HELP polymarket_order_latency_ms_avg Average order latency in ms',
      '# TYPE polymarket_order_latency_ms_avg gauge',
      `polymarket_order_latency_ms_avg ${metrics.avgOrderLatencyMs}`,
      '# HELP polymarket_expected_edge_total Sum of expected edge',
      '# TYPE polymarket_expected_edge_total gauge',
      `polymarket_expected_edge_total ${metrics.expectedEdgeTotal}`,
      '# HELP polymarket_realized_edge_total Sum of realized edge',
      '# TYPE polymarket_realized_edge_total gauge',
      `polymarket_realized_edge_total ${metrics.realizedEdgeTotal}`,
      '# HELP polymarket_edge_capture_ratio Realized/Expected edge ratio',
      '# TYPE polymarket_edge_capture_ratio gauge',
      `polymarket_edge_capture_ratio ${metrics.edgeCaptureRatio}`,
      '# HELP polymarket_stale_modules_total Total stale modules detected by watchdog',
      '# TYPE polymarket_stale_modules_total gauge',
      `polymarket_stale_modules_total ${metrics.staleModulesTotal}`,
      '# HELP polymarket_module_heartbeat_age_ms Heartbeat age in milliseconds by module',
      '# TYPE polymarket_module_heartbeat_age_ms gauge',
      '# HELP polymarket_module_stale Staleness flag by module (1=stale)',
      '# TYPE polymarket_module_stale gauge',
      ...moduleMetrics
    ].join('\n');
  }
}
