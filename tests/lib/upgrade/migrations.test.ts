import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareJournalToDb, loadBundledJournal } from '@/lib/upgrade/migrations';
import { startPostgres, stopPostgres } from '../../helpers/db';

let connectionString = '';

beforeAll(async () => {
  connectionString = await startPostgres();
});

afterAll(async () => {
  await stopPostgres();
});

describe('migration-journal helper', () => {
  it('loads the bundled journal with a non-empty entries[] array', async () => {
    const j = await loadBundledJournal();
    expect(Array.isArray(j.entries)).toBe(true);
    expect(j.entries.length).toBeGreaterThan(0);
    expect(j.entries[0]).toMatchObject({ idx: expect.any(Number), tag: expect.any(String) });
  });

  it('reports pending = all entries when __drizzle_migrations is empty', async () => {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    try {
      // Drizzle stores its migration metadata in the "drizzle" schema by
      // default, but our compare helper queries current_schema(). We make
      // sure the public-schema variant is missing entirely so the helper
      // returns pending=all.
      await db.execute(sql`DROP TABLE IF EXISTS __drizzle_migrations`);
      const j = await loadBundledJournal();
      const cmp = await compareJournalToDb({ journal: j, db });
      expect(cmp.pending).toHaveLength(j.entries.length);
      expect(cmp.applied).toHaveLength(0);
      expect(cmp.drifted).toBe(false);
    } finally {
      await client.end();
    }
  });

  it('reports drifted=true when DB has more applied rows than the journal lists', async () => {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    try {
      await db.execute(sql`DROP TABLE IF EXISTS __drizzle_migrations`);
      await db.execute(sql`
        CREATE TABLE __drizzle_migrations (
          id serial PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `);
      const j = await loadBundledJournal();
      // Seed N+1 phantom rows to guarantee count > journal length.
      for (let i = 0; i < j.entries.length + 5; i++) {
        await db.execute(
          sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${'phantom-' + i}, ${Date.now()})`,
        );
      }
      const cmp = await compareJournalToDb({ journal: j, db });
      expect(cmp.drifted).toBe(true);
    } finally {
      await client.end();
    }
  });
});
