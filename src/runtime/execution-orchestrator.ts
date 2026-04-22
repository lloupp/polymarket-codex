import { planExecutionIntents, type OrderPlannerInput } from '../execution/order-planner';
import { type MetricsRegistry } from '../monitoring/metrics-registry';
import { type MonitoringWatchdog } from '../monitoring/watchdog';
import { type PortfolioExposureSnapshot, type PreTradeRiskEngine } from '../risk/pretrade-engine';
import { type CircuitBreaker } from '../risk/circuit-breaker';
import { type RuntimeStateStore } from './state-store';
import type { ExecutionIntent, Signal } from '../strategy/contracts';

export type OrchestratorEvent = {
  type:
    | 'cycle_started'
    | 'signal_blocked'
    | 'signal_accepted'
    | 'order_submitted'
    | 'order_failed'
    | 'reconcile_finished'
    | 'cycle_finished';
  cycleId: string;
  metadata: Record<string, unknown>;
};

export type CycleResult = {
  cycleId: string;
  signalsReceived: number;
  signalsAccepted: number;
  signalsBlocked: number;
  ordersSubmitted: number;
  ordersFailed: number;
  ordersFilled: number;
  reconciliation: { ordersUpdated: number; fillsInserted: number };
};

export type ExecutionOrchestratorConfig = {
  fetchSignals: () => Promise<Signal[]>;
  plannerConfig: Omit<OrderPlannerInput, 'signals'>;
  riskEngine: PreTradeRiskEngine;
  exposureProvider: (intent: ExecutionIntent) => Promise<PortfolioExposureSnapshot>;
  breaker: CircuitBreaker;
  metrics: MetricsRegistry;
  stateStore: RuntimeStateStore;
  executeIntent: (intent: ExecutionIntent) => Promise<{ fillId: string; executedPrice: number; executedSize: number }>;
  reconcileOnce: () => Promise<{ ordersUpdated: number; fillsInserted: number }>;
  onEvent?: (event: OrchestratorEvent) => Promise<void>;
  watchdog?: MonitoringWatchdog;
  now?: () => number;
};

function signalKey(signal: Signal): string {
  return `${signal.strategy}:${signal.marketId}:${signal.tokenId}:${signal.side}:${signal.timestamp}`;
}

function round(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export class ExecutionOrchestrator {
  private readonly config: ExecutionOrchestratorConfig;
  private cycleSequence = 0;

  constructor(config: ExecutionOrchestratorConfig) {
    this.config = config;
  }

  async runCycle(input: { cycleId?: string } = {}): Promise<CycleResult> {
    const cycleId = input.cycleId ?? `cycle-${++this.cycleSequence}`;
    this.config.watchdog?.heartbeat('orchestrator', { timestampMs: this.now() });
    await this.emit({ type: 'cycle_started', cycleId, metadata: {} });

    const signals = await this.config.fetchSignals();
    const seenInCycle = new Set<string>();

    const acceptedSignals: Signal[] = [];
    const blockedSignals: Array<{ signal: Signal; reason: string }> = [];
    const submittedOrders: Array<Record<string, unknown>> = [];

    let ordersFailed = 0;
    let ordersFilled = 0;

    for (const signal of signals) {
      const dedupKey = signalKey(signal);
      if (seenInCycle.has(dedupKey)) {
        this.config.metrics.recordSignalBlocked();
        blockedSignals.push({ signal, reason: 'duplicate_signal_in_cycle' });
        await this.emit({
          type: 'signal_blocked',
          cycleId,
          metadata: { reason: 'duplicate_signal_in_cycle', dedupKey }
        });
        continue;
      }
      seenInCycle.add(dedupKey);

      const breakerGate = this.config.breaker.canExecute();
      if (!breakerGate.allowed) {
        this.config.metrics.recordSignalBlocked();
        blockedSignals.push({ signal, reason: `breaker_block:${breakerGate.reason}` });
        await this.emit({
          type: 'signal_blocked',
          cycleId,
          metadata: { reason: breakerGate.reason, source: 'breaker' }
        });
        continue;
      }

      const intents = planExecutionIntents({
        signals: [signal],
        defaultSize: this.config.plannerConfig.defaultSize,
        defaultTifForLimit: this.config.plannerConfig.defaultTifForLimit,
        defaultTifForMarket: this.config.plannerConfig.defaultTifForMarket
      });

      for (const intent of intents) {
        const exposure = await this.config.exposureProvider(intent);
        const riskDecision = this.config.riskEngine.evaluate({ intent, exposure });

        if (riskDecision.decision === 'BLOCK') {
          this.config.metrics.recordSignalBlocked();
          blockedSignals.push({ signal, reason: riskDecision.reasons.join('; ') });
          await this.emit({
            type: 'signal_blocked',
            cycleId,
            metadata: { reason: riskDecision.reasons.join('; '), source: 'risk' }
          });
          continue;
        }

        this.config.metrics.recordSignalAccepted();
        acceptedSignals.push(signal);
        await this.emit({ type: 'signal_accepted', cycleId, metadata: { signalKey: dedupKey } });

        const startedAt = this.now();
        this.config.watchdog?.heartbeat('execution', { timestampMs: startedAt });
        try {
          const fill = await this.config.executeIntent(intent);
          const latencyMs = Math.max(0, this.now() - startedAt);

          this.config.metrics.recordOrderSubmitted({ latencyMs });
          this.config.metrics.recordOrderFilled({
            expectedEdge: signal.edge,
            realizedEdge: round(signal.edge)
          });

          ordersFilled += 1;
          await this.config.breaker.recordSuccess();
          await this.emit({
            type: 'order_submitted',
            cycleId,
            metadata: { fillId: fill.fillId, latencyMs }
          });

          submittedOrders.push({
            orderId: `order-${cycleId}-${submittedOrders.length + 1}`,
            marketId: intent.marketId,
            tokenId: intent.tokenId,
            side: intent.side,
            status: 'filled',
            size: fill.executedSize,
            price: fill.executedPrice,
            sourceSignal: signal
          });
        } catch (error) {
          const latencyMs = Math.max(0, this.now() - startedAt);
          this.config.metrics.recordOrderSubmitted({ latencyMs });
          ordersFailed += 1;

          await this.config.breaker.recordError({
            code: 'execution_error',
            message: error instanceof Error ? error.message : String(error)
          });

          await this.emit({
            type: 'order_failed',
            cycleId,
            metadata: {
              error: error instanceof Error ? error.message : String(error),
              latencyMs
            }
          });
        }
      }
    }

    const reconcileStartedAt = this.now();
    this.config.watchdog?.heartbeat('reconciliation', { timestampMs: reconcileStartedAt });
    const reconciliation = await this.config.reconcileOnce();
    await this.emit({
      type: 'reconcile_finished',
      cycleId,
      metadata: {
        ordersUpdated: reconciliation.ordersUpdated,
        fillsInserted: reconciliation.fillsInserted
      }
    });

    const watchdogStatus = await this.config.watchdog?.evaluate({ timestampMs: this.now() });

    const breakerState = this.config.breaker.getState();
    await this.config.stateStore.updateState({
      signals: acceptedSignals,
      orders: submittedOrders,
      risk: {
        breaker: breakerState,
        status: this.config.breaker.canExecute().allowed ? 'ok' : 'paused',
        lastCycleId: cycleId,
        blockedSignals: blockedSignals.length,
        acceptedSignals: acceptedSignals.length,
        reconciliation,
        watchdog: watchdogStatus ?? null
      }
    });

    const result: CycleResult = {
      cycleId,
      signalsReceived: signals.length,
      signalsAccepted: acceptedSignals.length,
      signalsBlocked: blockedSignals.length,
      ordersSubmitted: submittedOrders.length + ordersFailed,
      ordersFailed,
      ordersFilled,
      reconciliation
    };

    await this.emit({
      type: 'cycle_finished',
      cycleId,
      metadata: { ...result }
    });

    return result;
  }

  async runDeterministicLoop(input: {
    cycles: number;
    cycleIdPrefix?: string;
  }): Promise<CycleResult[]> {
    const results: CycleResult[] = [];
    const prefix = input.cycleIdPrefix ?? 'cycle';

    for (let i = 1; i <= input.cycles; i += 1) {
      const result = await this.runCycle({ cycleId: `${prefix}-${i}` });
      results.push(result);
    }

    return results;
  }

  private now(): number {
    return this.config.now ? this.config.now() : Date.now();
  }

  private async emit(event: OrchestratorEvent): Promise<void> {
    if (this.config.onEvent) {
      await this.config.onEvent(event);
    }
  }
}
