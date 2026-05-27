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

describe('migration 0041 workspace_pins', () => {
  it('creates workspace_pins with the expected columns', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'workspace_pins'
       ORDER BY column_name
    `)) as unknown as Array<{ column_name: string }>;
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'page_id',
      'pinned_at',
      'pinned_by',
      'position',
      'workspace_id',
    ]);
  });

  it('has a composite primary key on (workspace_id, page_id)', async () => {
    const pk = (await db.execute(drizzleSql`
      SELECT a.attname FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = 'workspace_pins'::regclass AND i.indisprimary
       ORDER BY a.attname
    `)) as unknown as Array<{ attname: string }>;
    expect(pk.map((r) => r.attname).sort()).toEqual(['page_id', 'workspace_id']);
  });

  it('cascades on workspace + page delete', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT confdeltype FROM pg_constraint
       WHERE conrelid = 'workspace_pins'::regclass AND contype = 'f'
    `)) as unknown as Array<{ confdeltype: string }>;
    // Three FKs total: workspace_id (cascade), page_id (cascade), pinned_by
    // (restrict). The cascade pair are the load-bearing pair for this test.
    const cascades = rows.filter((r) => r.confdeltype === 'c');
    expect(cascades.length).toBeGreaterThanOrEqual(2);
  });

  it('has an index on (workspace_id, position) for ordered fetches', async () => {
    const idxs = (await db.execute(drizzleSql`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'workspace_pins'
    `)) as unknown as Array<{ indexname: string }>;
    expect(idxs.some((r) => /workspace.*position/i.test(r.indexname))).toBe(true);
  });
});
