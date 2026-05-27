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

describe('migration 0040 spaces', () => {
  it('creates spaces with expected columns', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'spaces'
       ORDER BY column_name
    `)) as unknown as Array<{ column_name: string }>;
    const names = cols.map((c) => c.column_name).sort();
    expect(names).toEqual([
      'created_at',
      'icon',
      'id',
      'name',
      'parent_space_id',
      'position',
      'slug',
      'workspace_id',
    ]);
  });

  it('parent_space_id self-FK exists', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'spaces'::regclass AND contype = 'f'
         AND conkey @> ARRAY[(
           SELECT attnum FROM pg_attribute
            WHERE attrelid = 'spaces'::regclass AND attname = 'parent_space_id'
         )]
    `)) as unknown as Array<{ conname: string }>;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('slug is unique per workspace', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'spaces'
    `)) as unknown as Array<{ indexname: string }>;
    expect(rows.some((r) => /slug/i.test(r.indexname))).toBe(true);
  });

  it('creates space_members with role check', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'space_members'
       ORDER BY column_name
    `)) as unknown as Array<{ column_name: string }>;
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'created_at',
      'role',
      'space_id',
      'user_id',
    ]);
    const checks = (await db.execute(drizzleSql`
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'space_members'::regclass AND contype = 'c'
    `)) as unknown as Array<{ conname: string }>;
    expect(checks.some((c) => /role/i.test(c.conname))).toBe(true);
  });

  it('adds pages.space_id nullable FK', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'pages' AND column_name = 'space_id'
    `)) as unknown as Array<{ column_name: string; is_nullable: string }>;
    expect(cols).toHaveLength(1);
    expect(cols[0]?.is_nullable).toBe('YES');
  });
});
