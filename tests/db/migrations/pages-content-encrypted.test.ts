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

describe('migration 0036 — pages.content_encrypted', () => {
  it('adds pages.content_encrypted as nullable bytea with no default', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'pages' AND column_name = 'content_encrypted';
    `)) as unknown as Array<{
      data_type: string;
      udt_name: string;
      is_nullable: 'YES' | 'NO';
      column_default: string | null;
    }>;
    expect(cols).toHaveLength(1);
    // Postgres reports bytea via information_schema.data_type as 'bytea'.
    expect(cols[0]?.data_type).toBe('bytea');
    expect(cols[0]?.is_nullable).toBe('YES');
    expect(cols[0]?.column_default).toBeNull();
  });
});
