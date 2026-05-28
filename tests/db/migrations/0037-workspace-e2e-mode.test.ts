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

describe('migration 0037 — workspace_e2e_mode', () => {
  it("adds workspaces.e2e_mode text default 'off' NOT NULL", async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'workspaces' AND column_name = 'e2e_mode';
    `)) as unknown as Array<{
      data_type: string;
      is_nullable: 'YES' | 'NO';
      column_default: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data_type).toBe('text');
    expect(rows[0]?.is_nullable).toBe('NO');
    expect(rows[0]?.column_default).toMatch(/off/);
  });

  it('adds pages.encrypted_under_wsk boolean default false NOT NULL', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'pages' AND column_name = 'encrypted_under_wsk';
    `)) as unknown as Array<{
      data_type: string;
      is_nullable: 'YES' | 'NO';
      column_default: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data_type).toBe('boolean');
    expect(rows[0]?.is_nullable).toBe('NO');
    expect(rows[0]?.column_default).toMatch(/false/);
  });
});
