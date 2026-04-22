import test from 'node:test';
import assert from 'node:assert/strict';

import { AlertingService, TelegramTransport, type IncidentAlertPayload } from '../../src/monitoring/alerting';

test('MON-002: deve padronizar payload de alertas para breaker, ws down e erro crítico', async () => {
  const sent: IncidentAlertPayload[] = [];

  const service = new AlertingService({
    send: async (payload) => {
      sent.push(payload);
    }
  });

  await service.notify({
    incidentType: 'breaker',
    message: 'Circuit breaker acionado',
    context: { marketId: 'm1', reason: 'daily_drawdown' },
    timestamp: '2026-04-21T19:30:00.000Z'
  });

  await service.notify({
    incidentType: 'ws_down',
    message: 'Websocket disconnected',
    context: { endpoint: 'wss://clob.polymarket.com' },
    timestamp: '2026-04-21T19:31:00.000Z'
  });

  await service.notify({
    incidentType: 'critical_error',
    message: 'Unhandled exception in execution loop',
    context: { module: 'execution-worker' },
    timestamp: '2026-04-21T19:32:00.000Z'
  });

  assert.equal(sent.length, 3);
  assert.deepEqual(sent[0], {
    source: 'polymarket-codex',
    severity: 'critical',
    incidentType: 'breaker',
    message: 'Circuit breaker acionado',
    context: { marketId: 'm1', reason: 'daily_drawdown' },
    timestamp: '2026-04-21T19:30:00.000Z'
  });
  assert.equal(sent[1]?.severity, 'warning');
  assert.equal(sent[2]?.incidentType, 'critical_error');
});

test('MON-002: transporte Telegram deve enviar mensagem formatada e falhar em status não-2xx', async () => {
  const requests: Array<{ url: string; body: string }> = [];

  const transport = new TelegramTransport({
    botToken: '123:abc',
    chatId: '999',
    fetcher: async (url, init) => {
      requests.push({
        url,
        body: String(init?.body ?? '')
      });
      return { ok: true, status: 200 };
    }
  });

  await transport.send({
    source: 'polymarket-codex',
    severity: 'critical',
    incidentType: 'breaker',
    message: 'Circuit breaker acionado',
    context: { threshold: 3 },
    timestamp: '2026-04-21T19:40:00.000Z'
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url.includes('/sendMessage'), true);
  assert.equal(requests[0]?.body.includes('[POLYMARKET ALERT]'), true);
  assert.equal(requests[0]?.body.includes('incident=breaker'), true);

  const failingTransport = new TelegramTransport({
    botToken: '123:abc',
    chatId: '999',
    fetcher: async () => ({ ok: false, status: 500 })
  });

  await assert.rejects(
    () =>
      failingTransport.send({
        source: 'polymarket-codex',
        severity: 'critical',
        incidentType: 'critical_error',
        message: 'boom',
        context: {},
        timestamp: '2026-04-21T19:41:00.000Z'
      }),
    /telegram alert failed with status 500/
  );
});
