import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { startPostgres, stopPostgres } from '../helpers/db';

let uri = '';
beforeAll(async () => {
  uri = await startPostgres();
});
afterAll(async () => {
  await stopPostgres();
});

it('runs all migrations against an empty database', async () => {
  await runMigrations(uri);
  const sql = postgres(uri);
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `;
  await sql.end();
  const names = tables.map((t) => t.table_name).sort();
  expect(names).toEqual(
    expect.arrayContaining([
      'workspaces',
      'users',
      'workspace_members',
      'invite_tokens',
      'sessions',
      'accounts',
      'verification_tokens',
    ]),
  );
});
