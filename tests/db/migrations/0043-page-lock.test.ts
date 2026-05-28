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

describe('migration 0043 — page lock', () => {
  it('adds locked_at, locked_by, locked_until as nullable cols on pages', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
       WHERE table_name = 'pages'
         AND column_name IN ('locked_at', 'locked_by', 'locked_until')
       ORDER BY column_name
    `)) as unknown as Array<{
      column_name: string;
      is_nullable: string;
      data_type: string;
    }>;
    expect(cols).toHaveLength(3);
    expect(cols.every((c) => c.is_nullable === 'YES')).toBe(true);
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    expect(byName.locked_by?.data_type).toBe('uuid');
    expect(byName.locked_at?.data_type).toBe('timestamp with time zone');
    expect(byName.locked_until?.data_type).toBe('timestamp with time zone');
  });

  it('locked_by FK to users.id with ON DELETE SET NULL', async () => {
    const fks = (await db.execute(drizzleSql`
      SELECT
        tc.constraint_name,
        ccu.table_name AS foreign_table,
        ccu.column_name AS foreign_column,
        rc.delete_rule,
        kcu.column_name AS local_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu USING (constraint_name)
      JOIN information_schema.referential_constraints rc USING (constraint_name)
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'pages'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'locked_by'
    `)) as unknown as Array<{
      constraint_name: string;
      foreign_table: string;
      foreign_column: string;
      delete_rule: string;
      local_column: string;
    }>;
    expect(fks.length).toBeGreaterThanOrEqual(1);
    const lockedByFk = fks[0]!;
    expect(lockedByFk.foreign_table).toBe('users');
    expect(lockedByFk.foreign_column).toBe('id');
    expect(lockedByFk.delete_rule).toBe('SET NULL');
  });
});
