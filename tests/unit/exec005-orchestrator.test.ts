import test from 'node:test';
import assert from 'node:assert/strict';

import { ExecutionOrchestrator } from '../../src/runtime/execution-orchestrator';
import { MetricsRegistry } from '../../src/monitoring/metrics-registry';
import { MonitoringWatchdog } from '../../src/monitoring/watchdog';
import { PaperExecutor } from '../../src/execution/paper-executor';
import { PreTradeRiskEngine } from '../../src/risk/pretrade-engine';
import { CircuitBreaker } from '../../src/risk/circuit-breaker';
import { RuntimeStateStore } from '../../src/runtime/state-store';
import type { Signal } from '../../src/strategy/contracts';

function makeSignal(input: Partial<Signal> = {}): Signal {
  return {
    strategy: input.strategy ?? 'neg-risk-arb',
    marketId: input.marketId ?? 'm1',
    tokenId: input.tokenId ?? 't1',
    side: input.side ?? 'BUY',
    confidence: input.confidence ?? 0.8,
    edge: input.edge ?? 0.06,
    reason: input.reason ?? 'edge-positive',
    timestamp: input.timestamp ?? '2026-04-22T00:00:00.000Z',
    metadata: input.metadata
  };
}

test('EXEC-005: fluxo E2E determinístico deve executar Signal→Risk→Execution→Reconciliation', async () => {
  const metrics = new MetricsRegistry();
  const breaker = new CircuitBreaker({ maxConsecutiveErrors: 3, dailyDrawdownLimit: 1000 });
  const stateStore = new RuntimeStateStore();
  const paperExecutor = new PaperExecutor({ slippageBps: 0 });
  const events: string[] = [];
  const watchdog = new MonitoringWatchdog({
    modules: [
      { module: 'orchestrator', staleAfterMs: 10_000, incidentType: 'staleness' },
      { module: 'execution', staleAfterMs: 10_000, incidentType: 'staleness' },
      { module: 'reconciliation', staleAfterMs: 10_000, incidentType: 'staleness' }
    ],
    metrics,
    now: () => Date.now()
  });

  const orchestrator = new ExecutionOrchestrator({
    fetchSignals: async () => [
      makeSignal({ marketId: 'm1', tokenId: 't1', timestamp: '2026-04-22T01:00:00.000Z' }),
      makeSignal({ marketId: 'm1', tokenId: 't1', timestamp: '2026-04-22T01:00:00.000Z' }), // duplicado no ciclo
      makeSignal({ marketId: 'm2', tokenId: 't2', timestamp: '2026-04-22T01:00:01.000Z', edge: 0.08 })
    ],
    riskEngine: new PreTradeRiskEngine({
      maxTradeNotional: 100,
      maxMarketNotional: 1000,
      maxGlobalNotional: 1000
    }),
    exposureProvider: async () => ({ marketExposureNotional: 0, globalExposureNotional: 0 }),
    breaker,
    metrics,
    stateStore,
    plannerConfig: {
      defaultSize: 10,
      defaultTifForLimit: 'GTC',
      defaultTifForMarket: 'IOC'
    },
    executeIntent: async (intent) => paperExecutor.execute(intent),
    reconcileOnce: async () => ({ ordersUpdated: 2, fillsInserted: 2 }),
    watchdog,
    onEvent: async (event) => {
      events.push(event.type);
    }
  });

  const result = await orchestrator.runCycle({ cycleId: 'cycle-1' });

  assert.equal(result.cycleId, 'cycle-1');
  assert.equal(result.signalsReceived, 3);
  assert.equal(result.signalsAccepted, 2);
  assert.equal(result.signalsBlocked, 1);
  assert.equal(result.ordersSubmitted, 2);
  assert.equal(result.ordersFailed, 0);
  assert.equal(result.ordersFilled, 2);

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.ordersSubmitted, 2);
  assert.equal(snapshot.ordersFilled, 2);
  assert.equal(snapshot.signalsAccepted, 2);
  assert.equal(snapshot.signalsBlocked, 1);
  assert.equal(snapshot.moduleHealth.some((module) => module.module === 'orchestrator'), true);
  assert.equal(snapshot.moduleHealth.some((module) => module.module === 'execution'), true);
  assert.equal(snapshot.moduleHealth.some((module) => module.module === 'reconciliation'), true);

  const runtime = await stateStore.getSnapshot();
  assert.equal(runtime.signals.length, 2);
  assert.equal(runtime.orders.length, 2);
  assert.equal(runtime.risk.status, 'ok');

  assert.equal(events.includes('cycle_started'), true);
  assert.equal(events.includes('cycle_finished'), true);
});

test('EXEC-005: breaker acionado deve bloquear execução em ciclos seguintes', async () => {
  const metrics = new MetricsRegistry();
  const breaker = new CircuitBreaker({ maxConsecutiveErrors: 1, dailyDrawdownLimit: 1000 });
  const stateStore = new RuntimeStateStore();

  let calls = 0;
  const orchestrator = new ExecutionOrchestrator({
    fetchSignals: async () => [makeSignal({ marketId: 'mx', tokenId: 'tx', timestamp: '2026-04-22T02:00:00.000Z' })],
    riskEngine: new PreTradeRiskEngine({
      maxTradeNotional: 100,
      maxMarketNotional: 1000,
      maxGlobalNotional: 1000
    }),
    exposureProvider: async () => ({ marketExposureNotional: 0, globalExposureNotional: 0 }),
    breaker,
    metrics,
    stateStore,
    plannerConfig: {
      defaultSize: 10,
      defaultTifForLimit: 'GTC',
      defaultTifForMarket: 'IOC'
    },
    executeIntent: async () => {
      calls += 1;
      throw new Error('executor failure');
    },
    reconcileOnce: async () => ({ ordersUpdated: 0, fillsInserted: 0 })
  });

  const first = await orchestrator.runCycle({ cycleId: 'cycle-err' });
  assert.equal(first.ordersSubmitted, 1);
  assert.equal(first.ordersFailed, 1);
  assert.equal(calls, 1);

  const second = await orchestrator.runCycle({ cycleId: 'cycle-blocked' });
  assert.equal(second.ordersSubmitted, 0);
  assert.equal(second.signalsBlocked, 1);
  assert.equal(calls, 1);

  const runtime = await stateStore.getSnapshot();
  const risk = runtime.risk as { breaker: { tripped: boolean }; status: string };
  assert.equal(risk.breaker.tripped, true);
  assert.equal(risk.status, 'paused');
});
