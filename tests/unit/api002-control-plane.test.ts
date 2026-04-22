import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { createApp } from '../../src/app';
import { RuntimeControlPlane } from '../../src/runtime/control-plane';
import { CircuitBreaker } from '../../src/risk/circuit-breaker';

test('API-002: deve bloquear comandos sem token admin e permitir com token válido', async () => {
  const breaker = new CircuitBreaker({ maxConsecutiveErrors: 3, dailyDrawdownLimit: 1000 });
  const controlPlane = new RuntimeControlPlane({ breaker });

  const app = createApp({
    provider: {
      getRisk: async () => ({
        breaker: breaker.getState(),
        status: 'ok'
      })
    },
    control: {
      plane: controlPlane,
      adminToken: 'secret-admin-token'
    }
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(`${baseUrl}/control/pause`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'manual' })
  });
  assert.equal(unauthorized.status, 401);

  const authorized = await fetch(`${baseUrl}/control/pause`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-token': 'secret-admin-token'
    },
    body: JSON.stringify({ reason: 'manual_pause', actor: 'eduardo' })
  });
  const authorizedBody = await authorized.json();

  assert.equal(authorized.status, 200);
  assert.equal(authorizedBody.result.changed, true);
  assert.equal(authorizedBody.result.paused, true);

  const risk = await fetch(`${baseUrl}/risk`).then((response) => response.json());
  assert.equal(risk.risk.status, 'paused');
  assert.equal(risk.risk.control.paused, true);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

test('API-002: comandos devem ser idempotentes e reset-breaker deve refletir em /risk', async () => {
  const breaker = new CircuitBreaker({ maxConsecutiveErrors: 1, dailyDrawdownLimit: 1000 });
  await breaker.recordError({ code: 'e1', message: 'fail once to trip' });
  assert.equal(breaker.getState().tripped, true);

  const controlPlane = new RuntimeControlPlane({ breaker });

  const app = createApp({
    provider: {
      getRisk: async () => ({
        breaker: breaker.getState(),
        status: 'ok'
      })
    },
    control: {
      plane: controlPlane,
      adminToken: 'secret-admin-token'
    }
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const headers = {
    'content-type': 'application/json',
    'x-admin-token': 'secret-admin-token'
  };

  const pause1 = await fetch(`${baseUrl}/control/pause`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: 'manual' })
  }).then((response) => response.json());

  const pause2 = await fetch(`${baseUrl}/control/pause`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: 'manual_again' })
  }).then((response) => response.json());

  assert.equal(pause1.result.changed, true);
  assert.equal(pause2.result.changed, false);

  const reset = await fetch(`${baseUrl}/control/reset-breaker`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: 'incident_resolved' })
  }).then((response) => response.json());

  assert.equal(reset.result.changed, true);

  const riskAfterReset = await fetch(`${baseUrl}/risk`).then((response) => response.json());
  assert.equal(riskAfterReset.risk.breaker.tripped, false);
  assert.equal(riskAfterReset.risk.status, 'paused');

  const resume1 = await fetch(`${baseUrl}/control/resume`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: 'manual_resume' })
  }).then((response) => response.json());

  const resume2 = await fetch(`${baseUrl}/control/resume`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: 'manual_resume_again' })
  }).then((response) => response.json());

  assert.equal(resume1.result.changed, true);
  assert.equal(resume2.result.changed, false);

  const riskAfterResume = await fetch(`${baseUrl}/risk`).then((response) => response.json());
  assert.equal(riskAfterResume.risk.status, 'ok');
  assert.equal(riskAfterResume.risk.control.paused, false);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});
