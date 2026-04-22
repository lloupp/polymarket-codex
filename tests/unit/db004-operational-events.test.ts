import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { newDb } from 'pg-mem';

import { PgMigrationRunner, loadSqlMigrations } from '../../src/storage/migrations';
import { CycleRunRepository, OperationalEventRepository } from '../../src/storage/repositories';

async function setupDb() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const client = new adapter.Client();
  await client.connect();

  const migrations = await loadSqlMigrations(path.resolve(process.cwd(), 'config', 'migrations'));
  const runner = new PgMigrationRunner({ client, migrations });
  await runner.migrateUp();

  return { client };
}

test('DB-004: deve persistir e consultar últimos ciclos operacionais', async () => {
  const { client } = await setupDb();
  const cycleRepo = new CycleRunRepository(client);

  await cycleRepo.insert({
    cycleId: 'cycle-1',
    signalsReceived: 3,
    signalsAccepted: 2,
    signalsBlocked: 1,
    ordersSubmitted: 2,
    ordersFailed: 0,
    ordersFilled: 2,
    reconciliation: { ordersUpdated: 2, fillsInserted: 2 },
    status: 'completed',
    startedAt: '2026-04-22T01:00:00.000Z',
    finishedAt: '2026-04-22T01:00:10.000Z'
  });

  await cycleRepo.insert({
    cycleId: 'cycle-2',
    signalsReceived: 1,
    signalsAccepted: 1,
    signalsBlocked: 0,
    ordersSubmitted: 1,
    ordersFailed: 1,
    ordersFilled: 0,
    reconciliation: { ordersUpdated: 0, fillsInserted: 0 },
    status: 'failed',
    startedAt: '2026-04-22T01:01:00.000Z',
    finishedAt: '2026-04-22T01:01:08.000Z'
  });

  const recent = await cycleRepo.listRecent(1);

  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.cycle_id, 'cycle-2');
  assert.equal(recent[0]?.status, 'failed');

  await client.end();
});

test('DB-004: deve persistir e filtrar eventos operacionais recentes', async () => {
  const { client } = await setupDb();
  const eventRepo = new OperationalEventRepository(client);

  await eventRepo.insert({
    eventType: 'breaker_tripped',
    severity: 'critical',
    source: 'risk',
    payload: { reason: 'daily_drawdown', drawdown: 120 }
  });

  await eventRepo.insert({
    eventType: 'control_pause',
    severity: 'warning',
    source: 'api-control',
    payload: { actor: 'eduardo', reason: 'manual_pause' }
  });

  const allRecent = await eventRepo.listRecent({ limit: 10 });
  assert.equal(allRecent.length, 2);

  const breakerOnly = await eventRepo.listRecent({ limit: 10, eventType: 'breaker_tripped' });
  assert.equal(breakerOnly.length, 1);
  assert.equal(breakerOnly[0]?.event_type, 'breaker_tripped');

  await client.end();
});
