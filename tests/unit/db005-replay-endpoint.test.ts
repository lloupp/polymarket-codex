import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { createApp } from '../../src/app';

test('DB-005: endpoint /replay deve encaminhar filtros e retornar payload do provider', async () => {
  let capturedQuery: Record<string, unknown> | null = null;

  const app = createApp({
    provider: {
      getReplay: async (query) => {
        capturedQuery = query;
        return {
          generatedAt: '2026-04-22T11:00:00.000Z',
          filters: query,
          cycles: [{ cycle_id: 'cycle-10' }],
          events: [{ event_type: 'breaker_tripped' }],
          summary: { cycles: 1, events: 1, eventTypes: ['breaker_tripped'] }
        };
      }
    }
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const response = await fetch(
    `${baseUrl}/replay?limit=25&eventType=breaker_tripped&from=2026-04-22T10:00:00.000Z&to=2026-04-22T11:00:00.000Z`
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(capturedQuery?.limit, 25);
  assert.equal(capturedQuery?.eventType, 'breaker_tripped');
  assert.equal(capturedQuery?.from, '2026-04-22T10:00:00.000Z');
  assert.equal(capturedQuery?.to, '2026-04-22T11:00:00.000Z');
  assert.equal(body.replay.summary.cycles, 1);

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
