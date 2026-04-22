import test from 'node:test';
import assert from 'node:assert/strict';

import { CircuitBreaker } from '../../src/risk/circuit-breaker';

test('RISK-003: deve acionar breaker após N erros consecutivos e emitir alerta', async () => {
  const alerts: Array<{ reason: string; message: string }> = [];
  const events: Array<{ type: string; reason?: string }> = [];

  const breaker = new CircuitBreaker({
    maxConsecutiveErrors: 3,
    dailyDrawdownLimit: 200,
    onAlert: async (payload) => {
      alerts.push({ reason: payload.reason, message: payload.message });
    },
    persistEvent: async (event) => {
      events.push({ type: event.type, reason: event.reason });
    }
  });

  await breaker.recordError({ code: 'ws_down', message: 'websocket offline' });
  await breaker.recordError({ code: 'clob_500', message: 'upstream error' });
  assert.equal(breaker.getState().tripped, false);

  await breaker.recordError({ code: 'clob_429', message: 'rate limited' });

  const state = breaker.getState();
  assert.equal(state.tripped, true);
  assert.equal(state.tripReason, 'consecutive_errors');
  assert.equal(state.consecutiveErrors, 3);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.reason, 'consecutive_errors');
  assert.equal(
    events.some((event) => event.type === 'breaker_tripped' && event.reason === 'consecutive_errors'),
    true
  );
});

test('RISK-003: deve acionar breaker por drawdown diário acima do limite', async () => {
  const alerts: Array<{ reason: string }> = [];

  const breaker = new CircuitBreaker({
    maxConsecutiveErrors: 5,
    dailyDrawdownLimit: 100,
    onAlert: async (payload) => {
      alerts.push({ reason: payload.reason });
    }
  });

  await breaker.updateDailyPnl({ realizedPnl: -45, unrealizedPnl: -20, timestamp: '2026-04-21T12:00:00.000Z' });
  assert.equal(breaker.getState().tripped, false);

  await breaker.updateDailyPnl({ realizedPnl: -80, unrealizedPnl: -30, timestamp: '2026-04-21T14:00:00.000Z' });

  const state = breaker.getState();
  assert.equal(state.tripped, true);
  assert.equal(state.tripReason, 'daily_drawdown');
  assert.equal(state.dailyDrawdown, 110);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.reason, 'daily_drawdown');
});

test('RISK-003: reset diário deve destravar execução e limpar contadores', async () => {
  const breaker = new CircuitBreaker({
    maxConsecutiveErrors: 1,
    dailyDrawdownLimit: 50
  });

  await breaker.recordError({ code: 'critical', message: 'critical error' });
  assert.equal(breaker.canExecute().allowed, false);

  await breaker.reset({ reason: 'manual_reset_after_incident' });

  const state = breaker.getState();
  assert.equal(state.tripped, false);
  assert.equal(state.consecutiveErrors, 0);
  assert.equal(state.dailyDrawdown, 0);
  assert.equal(breaker.canExecute().allowed, true);
});
