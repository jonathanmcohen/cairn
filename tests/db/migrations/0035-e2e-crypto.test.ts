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

describe('migration 0035 — e2e_crypto', () => {
  it('creates user_keypairs, page_encryption_keys, workspace_encryption_keys', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('user_keypairs','page_encryption_keys','workspace_encryption_keys')
      ORDER BY table_name;
    `)) as unknown as Array<{ table_name: string }>;
    expect(rows.map((r) => r.table_name)).toEqual([
      'page_encryption_keys',
      'user_keypairs',
      'workspace_encryption_keys',
    ]);
  });

  it('adds pages.encrypted defaulting to false', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'pages' AND column_name = 'encrypted';
    `)) as unknown as Array<{
      column_name: string;
      data_type: string;
      column_default: string | null;
      is_nullable: 'YES' | 'NO';
    }>;
    expect(cols).toHaveLength(1);
    expect(cols[0]?.data_type).toBe('boolean');
    expect(cols[0]?.is_nullable).toBe('NO');
    expect(cols[0]?.column_default).toMatch(/false/);
  });

  it('page_encryption_keys + workspace_encryption_keys have composite primary keys', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_name IN ('page_encryption_keys','workspace_encryption_keys')
      ORDER BY tc.table_name, kcu.ordinal_position;
    `)) as unknown as Array<{ table_name: string; column_name: string }>;
    expect(rows).toEqual([
      { table_name: 'page_encryption_keys', column_name: 'page_id' },
      { table_name: 'page_encryption_keys', column_name: 'member_user_id' },
      { table_name: 'workspace_encryption_keys', column_name: 'workspace_id' },
      { table_name: 'workspace_encryption_keys', column_name: 'member_user_id' },
    ]);
  });
});
