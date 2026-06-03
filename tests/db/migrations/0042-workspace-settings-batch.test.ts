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

describe('migration 0042 — workspace settings batch', () => {
  it('adds the three new columns with the expected defaults', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name, data_type, column_default
        FROM information_schema.columns
       WHERE table_name = 'workspaces'
         AND column_name IN ('trash_retention_days', 'default_page_status', 'enable_federated_search')
       ORDER BY column_name
    `)) as unknown as Array<{
      column_name: string;
      data_type: string;
      column_default: string | null;
    }>;
    expect(cols).toHaveLength(3);
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    expect(byName.trash_retention_days?.column_default).toContain('30');
    // v0.9.9 K2 #216 — migration 0066 flipped this column default from
    // 'published' to 'draft' (new pages are born as drafts, security-adjacent).
    // This test reads the live information_schema after ALL migrations.
    expect(byName.default_page_status?.column_default).toContain("'draft'");
    expect(byName.enable_federated_search?.column_default).toContain('false');
  });

  it('newly inserted workspaces receive the declared defaults', async () => {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(drizzleSql`
      INSERT INTO workspaces (name, slug) VALUES ('w', ${`w-${ts}`})
    `);
    const rows = (await db.execute(drizzleSql`
      SELECT trash_retention_days, default_page_status, enable_federated_search
        FROM workspaces
       WHERE slug = ${`w-${ts}`}
    `)) as unknown as Array<{
      trash_retention_days: number;
      default_page_status: string;
      enable_federated_search: boolean;
    }>;
    expect(rows[0]?.trash_retention_days).toBe(30);
    // v0.9.9 K2 #216 — migration 0066 changed the effective default to 'draft'.
    expect(rows[0]?.default_page_status).toBe('draft');
    expect(rows[0]?.enable_federated_search).toBe(false);
  });
});
