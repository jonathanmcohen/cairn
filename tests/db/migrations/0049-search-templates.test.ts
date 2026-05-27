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

describe('migration 0049 search_templates', () => {
  it('adds saved_searches.template_name column', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'saved_searches' AND column_name = 'template_name'
    `)) as unknown as Array<{ column_name: string }>;
    expect(cols).toHaveLength(1);
  });

  it('creates a partial unique index limited to template_name IS NOT NULL', async () => {
    const idx = (await db.execute(drizzleSql`
      SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'saved_searches'
         AND indexname = 'saved_searches_template_name_uq'
    `)) as unknown as Array<{ indexname: string; indexdef: string }>;
    expect(idx).toHaveLength(1);
    expect(idx[0]?.indexdef).toMatch(/template_name IS NOT NULL/i);
    expect(idx[0]?.indexdef).toMatch(/UNIQUE/i);
  });
});
