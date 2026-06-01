import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { startPostgres, stopPostgres } from '../helpers/db';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

it('automation_rules has a nullable builder jsonb column', async () => {
  const rows = await sql`
    SELECT data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'automation_rules' AND column_name = 'builder'
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.data_type).toBe('jsonb');
  expect(rows[0]?.is_nullable).toBe('YES');
});
