import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('migration 0057 — page_acls(page_id) index', () => {
  it('creates page_acls_page_id_idx', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
       WHERE tablename = 'page_acls' AND indexname = 'page_acls_page_id_idx'
    `;
    expect(rows.length).toBe(1);
  });
});
