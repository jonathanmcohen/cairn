import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

describe('migration 0050 peer_instances', () => {
  it('creates peer_instances with the expected columns', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'peer_instances'
       ORDER BY column_name
    `)) as unknown as Array<{ column_name: string }>;
    const names = cols.map((r) => r.column_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'base_url',
        'created_at',
        'enabled',
        'id',
        'last_error',
        'last_synced_at',
        'name',
        'shared_secret_hash',
        'workspace_id',
      ]),
    );
  });

  it('enforces UNIQUE (workspace_id, name)', async () => {
    const def = (await db.execute(drizzleSql`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'peer_instances_workspace_name_uq'
    `)) as unknown as Array<{ indexdef: string }>;
    expect(def).toHaveLength(1);
    expect(def[0]?.indexdef).toMatch(/UNIQUE/i);
  });

  it('has a partial index on enabled = true', async () => {
    const def = (await db.execute(drizzleSql`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'peer_instances_enabled_idx'
    `)) as unknown as Array<{ indexdef: string }>;
    expect(def).toHaveLength(1);
    expect(def[0]?.indexdef).toMatch(/WHERE \(?enabled = true\)?/i);
  });
});
