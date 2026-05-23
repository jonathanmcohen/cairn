import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  client = postgres(uri);
  db = drizzle(client, { schema });
});
afterAll(async () => {
  await client.end();
  await stopPostgres();
});

describe('migration 0017 — suggestions', () => {
  it('creates the suggestion_status enum with the three values', async () => {
    const rows = (await db.execute(sql`
      SELECT enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'suggestion_status' ORDER BY e.enumsortorder
    `)) as unknown as { enumlabel: string }[];
    expect(rows.map((r) => r.enumlabel)).toEqual(['open', 'accepted', 'rejected']);
  });

  it('creates the suggestions table with the page_status index', async () => {
    const idx = (await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'suggestions' AND indexname = 'suggestions_page_status_idx'
    `)) as unknown as { indexname: string }[];
    expect(idx).toHaveLength(1);
  });
});
