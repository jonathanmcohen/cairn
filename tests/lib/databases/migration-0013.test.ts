import { sql as rawSql } from 'drizzle-orm';
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

describe('migration 0013', () => {
  it("adds 'list' to the view_type enum", async () => {
    const rows = (await db.execute(rawSql`
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'view_type'
    `)) as unknown as { label: string }[];
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('list');
    // sanity: the pre-existing values survive
    expect(labels).toEqual(
      expect.arrayContaining(['table', 'kanban', 'gallery', 'calendar', 'timeline']),
    );
  });

  it('adds a nullable parent_row_id column on db_rows', async () => {
    const rows = (await db.execute(rawSql`
      SELECT is_nullable, data_type
      FROM information_schema.columns
      WHERE table_name = 'db_rows' AND column_name = 'parent_row_id'
    `)) as unknown as { is_nullable: string; data_type: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_nullable).toBe('YES');
    expect(rows[0]?.data_type).toBe('uuid');
  });

  it('parent_row_id is a self-FK to db_rows(id) with ON DELETE SET NULL', async () => {
    const rows = (await db.execute(rawSql`
      SELECT rc.delete_rule, ccu.table_name AS ref_table, ccu.column_name AS ref_column
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.constraint_name
      WHERE kcu.table_name = 'db_rows' AND kcu.column_name = 'parent_row_id'
    `)) as unknown as { delete_rule: string; ref_table: string; ref_column: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delete_rule).toBe('SET NULL');
    expect(rows[0]?.ref_table).toBe('db_rows');
    expect(rows[0]?.ref_column).toBe('id');
  });

  it('indexes parent_row_id', async () => {
    const rows = (await db.execute(rawSql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'db_rows' AND indexdef ILIKE '%parent_row_id%'
    `)) as unknown as { indexname: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
