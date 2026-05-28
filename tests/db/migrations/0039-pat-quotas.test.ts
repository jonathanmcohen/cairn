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

describe('migration 0039 — pat_quotas', () => {
  it('adds three quota columns to personal_access_tokens', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'personal_access_tokens'
        AND column_name IN ('daily_request_limit', 'monthly_request_limit', 'scope_rate_limits')
      ORDER BY column_name
    `)) as unknown as Array<{ column_name: string; data_type: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.column_name === 'scope_rate_limits')?.data_type).toBe('jsonb');
    expect(rows.find((r) => r.column_name === 'daily_request_limit')?.data_type).toBe('integer');
    expect(rows.find((r) => r.column_name === 'monthly_request_limit')?.data_type).toBe('integer');
  });

  it('creates pat_quota_usage with the expected columns', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'pat_quota_usage'
      ORDER BY column_name
    `)) as unknown as Array<{ column_name: string }>;
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'bytes',
      'requests',
      'token_id',
      'window_kind',
      'window_start',
    ]);
  });

  it('pat_quota_usage has composite primary key (token_id, window_start, window_kind)', async () => {
    const pk = (await db.execute(drizzleSql`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'pat_quota_usage'::regclass AND i.indisprimary
      ORDER BY a.attname
    `)) as unknown as Array<{ attname: string }>;
    expect(pk.map((r) => r.attname).sort()).toEqual(['token_id', 'window_kind', 'window_start']);
  });

  it('window_kind has a CHECK constraint accepting day|month', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'pat_quota_usage'::regclass AND contype = 'c'
    `)) as unknown as Array<{ conname: string }>;
    expect(rows.some((r) => r.conname.includes('window_kind'))).toBe(true);
  });
});
