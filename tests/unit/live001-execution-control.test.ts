import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { createApp } from '../../src/app';
import { ExecutionGateway } from '../../src/execution/execution-gateway';
import { RuntimeControlPlane } from '../../src/runtime/control-plane';

test('LIVE-001: deve controlar execution mode/live-enabled/kill-switch via endpoints autenticados', async () => {
  const gateway = new ExecutionGateway({
    mode: 'paper',
    liveEnabled: false,
    killSwitch: false,
    paperExecutor: async () => ({ fillId: 'paper-1', executedPrice: 0.51, executedSize: 10 }),
    liveExecutor: async () => ({ fillId: 'live-1', executedPrice: 0.52, executedSize: 10 })
  });

  const controlPlane = new RuntimeControlPlane({ executionGateway: gateway });

  const app = createApp({
    control: {
      plane: controlPlane,
      adminToken: 'secret-admin-token'
    }
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(`${baseUrl}/control/execution-mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'live' })
  });
  assert.equal(unauthorized.status, 401);

  const headers = {
    'content-type': 'application/json',
    'x-admin-token': 'secret-admin-token'
  };

  const badPayload = await fetch(`${baseUrl}/control/execution-mode`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'invalid_mode' })
  });
  assert.equal(badPayload.status, 400);

  const toLive = await fetch(`${baseUrl}/control/execution-mode`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'live', reason: 'pilot_start', actor: 'eduardo' })
  }).then((response) => response.json());

  assert.equal(toLive.ok, true);
  assert.equal(toLive.command, 'execution-mode');
  assert.equal(toLive.result.changed, true);
  assert.equal(toLive.result.status.configuredMode, 'live');

  const enableLive = await fetch(`${baseUrl}/control/live-enabled`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ enabled: true, reason: 'pilot_gate_open' })
  }).then((response) => response.json());

  assert.equal(enableLive.result.changed, true);
  assert.equal(enableLive.result.status.liveEnabled, true);

  const activateKillSwitch = await fetch(`${baseUrl}/control/kill-switch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ enabled: true, reason: 'safety_trigger' })
  }).then((response) => response.json());

  assert.equal(activateKillSwitch.result.changed, true);
  assert.equal(activateKillSwitch.result.status.killSwitch, true);
  assert.equal(activateKillSwitch.result.status.effectiveMode, 'paper');

  const executionStatus = await fetch(`${baseUrl}/execution`).then((response) => response.json());

  assert.equal(executionStatus.execution.configuredMode, 'live');
  assert.equal(executionStatus.execution.effectiveMode, 'paper');
  assert.equal(executionStatus.execution.blockedReason, 'kill_switch_forced_paper');

  const risk = await fetch(`${baseUrl}/risk`).then((response) => response.json());
  assert.equal(risk.risk.control.execution.configuredMode, 'live');
  assert.equal(risk.risk.control.execution.killSwitch, true);

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
