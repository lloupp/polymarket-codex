import { promises as fs } from 'node:fs';
import path from 'node:path';

export type SqlMigration = {
  version: string;
  name: string;
  up: string;
  down: string;
};

type QueryableClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export async function loadSqlMigrations(
  migrationsDir = path.resolve(process.cwd(), 'config', 'migrations')
): Promise<SqlMigration[]> {
  const entries = await fs.readdir(migrationsDir);
  const upFiles = entries.filter((entry) => entry.endsWith('.up.sql')).sort();

  const migrations: SqlMigration[] = [];

  for (const fileName of upFiles) {
    const match = fileName.match(/^(\d+)_([a-z0-9_]+)\.up\.sql$/i);
    if (!match) {
      continue;
    }

    const version = match[1] as string;
    const name = match[2] as string;
    const upPath = path.join(migrationsDir, fileName);
    const downPath = path.join(migrationsDir, `${version}_${name}.down.sql`);

    const [up, down] = await Promise.all([
      fs.readFile(upPath, 'utf-8'),
      fs.readFile(downPath, 'utf-8')
    ]);

    migrations.push({ version, name, up, down });
  }

  return migrations;
}

export class PgMigrationRunner {
  private readonly client: QueryableClient;
  private readonly migrations: SqlMigration[];

  constructor(input: { client: QueryableClient; migrations: SqlMigration[] }) {
    this.client = input.client;
    this.migrations = [...input.migrations].sort((a, b) => a.version.localeCompare(b.version));
  }

  async migrateUp(): Promise<void> {
    await this.ensureSchemaTable();

    const applied = await this.getAppliedVersions();

    for (const migration of this.migrations) {
      if (applied.has(migration.version)) {
        continue;
      }

      await this.client.query('BEGIN');
      try {
        await this.client.query(migration.up);
        await this.client.query(
          'insert into schema_migrations(version, name, applied_at) values($1, $2, now())',
          [migration.version, migration.name]
        );
        await this.client.query('COMMIT');
      } catch (error) {
        await this.client.query('ROLLBACK');
        throw error;
      }
    }
  }

  async rollbackAll(): Promise<void> {
    await this.ensureSchemaTable();

    while (await this.rollbackLast()) {
      // continue while there are applied migrations
    }
  }

  private async rollbackLast(): Promise<boolean> {
    const result = await this.client.query(
      'select version from schema_migrations order by version desc limit 1'
    );

    const row = result.rows[0] as { version?: string } | undefined;
    if (!row?.version) {
      return false;
    }

    const migration = this.migrations.find((entry) => entry.version === row.version);
    if (!migration) {
      throw new Error(`Migration not found for rollback: ${row.version}`);
    }

    await this.client.query('BEGIN');
    try {
      await this.client.query(migration.down);
      await this.client.query('delete from schema_migrations where version = $1', [migration.version]);
      await this.client.query('COMMIT');
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }

    return true;
  }

  private async ensureSchemaTable(): Promise<void> {
    try {
      await this.client.query(`
        create table schema_migrations (
          version text primary key,
          name text not null,
          applied_at timestamptz not null
        );
      `);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes('already exists')) {
        throw error;
      }
    }
  }

  private async getAppliedVersions(): Promise<Set<string>> {
    const rows = await this.client.query('select version from schema_migrations');
    return new Set(rows.rows.map((row) => String(row.version)));
  }
}
