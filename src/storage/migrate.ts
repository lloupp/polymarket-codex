import { Client } from 'pg';

import { PgMigrationRunner, loadSqlMigrations } from './migrations';

async function run(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL for migration command');
  }

  const migrations = await loadSqlMigrations();
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    const runner = new PgMigrationRunner({ client, migrations });

    if (command === 'up') {
      await runner.migrateUp();
      return;
    }

    if (command === 'down') {
      await runner.rollbackAll();
      return;
    }

    throw new Error(`Unsupported migration command: ${command}`);
  } finally {
    await client.end();
  }
}

void run();
