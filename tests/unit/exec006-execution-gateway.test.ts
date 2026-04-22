import test from 'node:test';
import assert from 'node:assert/strict';

import { ExecutionGateway, ExecutionModeError } from '../../src/execution/execution-gateway';
import type { ExecutionIntent, Signal } from '../../src/strategy/contracts';
import { ExecutionOrchestrator } from '../../src/runtime/execution-orchestrator';
import { MetricsRegistry } from '../../src/monitoring/metrics-registry';
import { PreTradeRiskEngine } from '../../src/risk/pretrade-engine';
import { CircuitBreaker } from '../../src/risk/circuit-breaker';
import { RuntimeStateStore } from '../../src/runtime/state-store';

function makeSignal(): Signal {
  return {
    strategy: 'neg-risk-arb',
    marketId: 'm1',
    tokenId: 't1',
    side: 'BUY',
    confidence: 0.8,
    edge: 0.07,
    reason: 'edge-positive',
    timestamp: '2026-04-22T10:00:00.000Z'
  };
}

function makeIntent(): ExecutionIntent {
  return {
    marketId: 'm1',
    tokenId: 't1',
    side: 'BUY',
    orderType: 'LIMIT',
    size: 10,
    price: 0.5,
    timeInForce: 'GTC',
    sourceSignal: makeSignal(),
    riskTags: ['unit-test']
  };
}

test('EXEC-006: modo paper deve executar via paperExecutor', async () => {
  const calls: string[] = [];
  const gateway = new ExecutionGateway({
    mode: 'paper',
    liveEnabled: false,
    paperExecutor: async () => {
      calls.push('paper');
      return { fillId: 'paper-1', executedPrice: 0.5, executedSize: 10 };
    },
    liveExecutor: async () => {
      calls.push('live');
      return { fillId: 'live-1', executedPrice: 0.51, executedSize: 10 };
    }
  });

  const result = await gateway.execute(makeIntent());

  assert.equal(result.fillId, 'paper-1');
  assert.deepEqual(calls, ['paper']);
  assert.equal(gateway.getStatus().effectiveMode, 'paper');
});

test('EXEC-006: modo live sem liveEnabled deve bloquear com erro claro', async () => {
  const gateway = new ExecutionGateway({
    mode: 'live',
    liveEnabled: false,
    paperExecutor: async () => ({ fillId: 'paper-1', executedPrice: 0.5, executedSize: 10 }),
    liveExecutor: async () => ({ fillId: 'live-1', executedPrice: 0.51, executedSize: 10 })
  });

  await assert.rejects(() => gateway.execute(makeIntent()), (error: unknown) => {
    assert.equal(error instanceof ExecutionModeError, true);
    assert.equal((error as ExecutionModeError).code, 'LIVE_NOT_ENABLED');
    return true;
  });

  const status = gateway.getStatus();
  assert.equal(status.configuredMode, 'live');
  assert.equal(status.effectiveMode, 'blocked');
  assert.equal(status.blockedReason, 'live_not_enabled');
});

test('EXEC-006: modo live com liveEnabled deve executar via liveExecutor', async () => {
  const calls: string[] = [];
  const gateway = new ExecutionGateway({
    mode: 'live',
    liveEnabled: true,
    paperExecutor: async () => {
      calls.push('paper');
      return { fillId: 'paper-1', executedPrice: 0.5, executedSize: 10 };
    },
    liveExecutor: async () => {
      calls.push('live');
      return { fillId: 'live-1', executedPrice: 0.51, executedSize: 10 };
    }
  });

  const result = await gateway.execute(makeIntent());

  assert.equal(result.fillId, 'live-1');
  assert.deepEqual(calls, ['live']);
  assert.equal(gateway.getStatus().effectiveMode, 'live');
});

test('EXEC-006: kill-switch deve forçar fallback para paper mesmo em modo live', async () => {
  const calls: string[] = [];
  const gateway = new ExecutionGateway({
    mode: 'live',
    liveEnabled: true,
    killSwitch: true,
    paperExecutor: async () => {
      calls.push('paper');
      return { fillId: 'paper-fallback', executedPrice: 0.49, executedSize: 10 };
    },
    liveExecutor: async () => {
      calls.push('live');
      return { fillId: 'live-1', executedPrice: 0.51, executedSize: 10 };
    }
  });

  const result = await gateway.execute(makeIntent());

  assert.equal(result.fillId, 'paper-fallback');
  assert.deepEqual(calls, ['paper']);

  const status = gateway.getStatus();
  assert.equal(status.effectiveMode, 'paper');
  assert.equal(status.blockedReason, 'kill_switch_forced_paper');
});

test('LIVE-002: erro crítico em live deve acionar failover automático para paper', async () => {
  const calls: string[] = [];
  const gateway = new ExecutionGateway({
    mode: 'live',
    liveEnabled: true,
    autoFailoverToPaperOnLiveError: true,
    paperExecutor: async () => {
      calls.push('paper');
      return { fillId: 'paper-after-failover', executedPrice: 0.5, executedSize: 10 };
    },
    liveExecutor: async () => {
      calls.push('live');
      throw new Error('live adapter critical failure');
    }
  });

  await assert.rejects(() => gateway.execute(makeIntent()), /critical failure/);

  const afterFailureStatus = gateway.getStatus();
  assert.equal(afterFailureStatus.killSwitch, true);
  assert.equal(afterFailureStatus.effectiveMode, 'paper');
  assert.equal(afterFailureStatus.blockedReason, 'auto_failover_live_error');
  assert.equal(afterFailureStatus.lastFailoverReason, 'live adapter critical failure');
  assert.equal(typeof afterFailureStatus.lastFailoverAt, 'string');

  const result = await gateway.execute(makeIntent());
  assert.equal(result.fillId, 'paper-after-failover');
  assert.deepEqual(calls, ['live', 'paper']);
});

test('LIVE-003: erro live não crítico não deve acionar failover automático', async () => {
  const calls: string[] = [];
  const gateway = new ExecutionGateway({
    mode: 'live',
    liveEnabled: true,
    autoFailoverToPaperOnLiveError: true,
    isCriticalLiveError: () => false,
    paperExecutor: async () => {
      calls.push('paper');
      return { fillId: 'paper-should-not-run', executedPrice: 0.5, executedSize: 10 };
    },
    liveExecutor: async () => {
      calls.push('live');
      throw new Error('temporary upstream timeout');
    }
  });

  await assert.rejects(() => gateway.execute(makeIntent()), /timeout/);

  const status = gateway.getStatus();
  assert.equal(status.killSwitch, false);
  assert.equal(status.effectiveMode, 'live');
  assert.equal(status.blockedReason, undefined);
  assert.equal(status.lastFailoverReason, undefined);

  await assert.rejects(() => gateway.execute(makeIntent()), /timeout/);
  assert.deepEqual(calls, ['live', 'live']);
});

test('LIVE-004: failover crítico deve travar lock até reset explícito e contar ocorrências', async () => {
  const gateway = new ExecutionGateway({
    mode: 'live',
    liveEnabled: true,
    autoFailoverToPaperOnLiveError: true,
    paperExecutor: async () => ({ fillId: 'paper-fallback', executedPrice: 0.5, executedSize: 10 }),
    liveExecutor: async () => {
      throw new Error('critical connector failure');
    }
  });

  await assert.rejects(() => gateway.execute(makeIntent()), /critical connector failure/);

  const lockedStatus = gateway.getStatus();
  assert.equal(lockedStatus.failoverLocked, true);
  assert.equal(lockedStatus.failoverCount, 1);
  assert.equal(lockedStatus.blockedReason, 'auto_failover_live_error');

  gateway.resetFailoverLock();

  const resetStatus = gateway.getStatus();
  assert.equal(resetStatus.failoverLocked, false);
  assert.equal(resetStatus.failoverCount, 1);
});

test('LIVE-005: reset failover lock deve respeitar cooldown de rearm', async () => {
  let nowMs = Date.UTC(2026, 3, 22, 11, 15, 0);

  const gateway = new ExecutionGateway({
    mode: 'live',
    liveEnabled: true,
    autoFailoverToPaperOnLiveError: true,
    failoverResetCooldownMs: 60_000,
    now: () => new Date(nowMs),
    paperExecutor: async () => ({ fillId: 'paper-fallback', executedPrice: 0.5, executedSize: 10 }),
    liveExecutor: async () => {
      throw new Error('critical connector failure');
    }
  });

  await assert.rejects(() => gateway.execute(makeIntent()), /critical connector failure/);

  gateway.resetFailoverLock();

  const earlyStatus = gateway.getStatus();
  assert.equal(earlyStatus.failoverLocked, true);
  assert.equal(earlyStatus.killSwitch, true);
  assert.equal(earlyStatus.cooldownRemainingMs, 60_000);

  nowMs += 60_000;
  gateway.resetFailoverLock();

  const unlockedStatus = gateway.getStatus();
  assert.equal(unlockedStatus.failoverLocked, false);
  assert.equal(unlockedStatus.killSwitch, false);
  assert.equal(unlockedStatus.cooldownRemainingMs, 0);
});

test('EXEC-006: integração com orquestrador deve manter fluxo atual em paper mode', async () => {
  const gateway = new ExecutionGateway({
    mode: 'paper',
    liveEnabled: false,
    paperExecutor: async () => ({ fillId: 'paper-2', executedPrice: 0.5, executedSize: 10 }),
    liveExecutor: async () => ({ fillId: 'live-2', executedPrice: 0.51, executedSize: 10 })
  });

  const orchestrator = new ExecutionOrchestrator({
    fetchSignals: async () => [makeSignal()],
    plannerConfig: {
      defaultSize: 10,
      defaultTifForLimit: 'GTC',
      defaultTifForMarket: 'IOC'
    },
    riskEngine: new PreTradeRiskEngine({
      maxTradeNotional: 100,
      maxMarketNotional: 1000,
      maxGlobalNotional: 1000
    }),
    exposureProvider: async () => ({ marketExposureNotional: 0, globalExposureNotional: 0 }),
    breaker: new CircuitBreaker({ maxConsecutiveErrors: 3, dailyDrawdownLimit: 1000 }),
    metrics: new MetricsRegistry(),
    stateStore: new RuntimeStateStore(),
    executeIntent: (intent) => gateway.execute(intent),
    reconcileOnce: async () => ({ ordersUpdated: 1, fillsInserted: 1 })
  });

  const result = await orchestrator.runCycle({ cycleId: 'exec006-integration' });
  assert.equal(result.ordersSubmitted, 1);
  assert.equal(result.ordersFailed, 0);
  assert.equal(result.ordersFilled, 1);
});
