import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { newDb } from 'pg-mem';

import { PgMigrationRunner, loadSqlMigrations } from '../../src/storage/migrations';

function createClient() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const client = new adapter.Client();
  return { db, client };
}

test('DB-001: deve carregar migration SQL versionada com up/down pareados', async () => {
  const migrationsDir = path.resolve(process.cwd(), 'config', 'migrations');
  const migrations = await loadSqlMigrations(migrationsDir);

  assert.equal(migrations.length >= 1, true);
  assert.equal(migrations[0]?.version, '001');
  assert.match(migrations[0]?.name ?? '', /initial_polymarket_schema/);
  assert.match(migrations[0]?.up ?? '', /create index if not exists idx_orderbook_snapshots_market_time/i);
  assert.match(migrations[0]?.up ?? '', /create index if not exists idx_trade_ticks_market_time/i);
  assert.match(migrations[0]?.up ?? '', /create index if not exists idx_trade_ticks_token_time/i);
});

test('DB-001: deve aplicar migration criando tabelas e indices esperados', async () => {
  const { db, client } = createClient();
  await client.connect();

  const migrations = await loadSqlMigrations(path.resolve(process.cwd(), 'config', 'migrations'));
  const runner = new PgMigrationRunner({ client, migrations });

  await runner.migrateUp();

  const tables = db.public
    .many(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name;
    `)
    .map((row: { table_name: string }) => row.table_name);

  assert.deepEqual(tables, [
    'ingestion_runs',
    'markets',
    'orderbook_snapshots',
    'schema_migrations',
    'trade_ticks'
  ]);

  await client.end();
});

test('DB-001: deve executar rollback completo removendo tabelas de dominio', async () => {
  const { db, client } = createClient();
  await client.connect();

  const migrations = await loadSqlMigrations(path.resolve(process.cwd(), 'config', 'migrations'));
  const runner = new PgMigrationRunner({ client, migrations });

  await runner.migrateUp();
  await runner.rollbackAll();

  const tables = db.public.many(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name;
  `);

  assert.deepEqual(tables, [{ table_name: 'schema_migrations' }]);

  await client.end();
});
