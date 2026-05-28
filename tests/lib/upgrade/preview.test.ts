import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { previewUpgrade } from '@/lib/upgrade/preview';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { hasPgDump } from '../../helpers/has-pg-dump';

let connectionString = '';

beforeAll(async () => {
  connectionString = await startPostgres();
  await runMigrations(connectionString);
});

afterAll(async () => {
  await stopPostgres();
});

describe.skipIf(!hasPgDump)('previewUpgrade', () => {
  it('returns ok=true with empty pending when DB is already current', async () => {
    const result = await previewUpgrade({ databaseUrl: connectionString });
    expect(result.ok).toBe(true);
    expect(result.pendingTags).toHaveLength(0);
  });

  it('emits a schema diff when a fresh DB needs the full migration set applied', async () => {
    // Clone-to-empty: drop everything in the test DB to simulate a fresh
    // upgrade. The Drizzle migrator stores its metadata in the `drizzle`
    // schema; nuke that too so it picks up "all pending".
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    try {
      await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
      await db.execute(sql`CREATE SCHEMA public`);
      await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    } finally {
      await client.end();
    }
    const result = await previewUpgrade({ databaseUrl: connectionString });
    expect(result.ok).toBe(true);
    expect(result.pendingTags.length).toBeGreaterThan(0);
    // schema diff should mention `pages` (a core table from the migration set)
    expect(result.schemaDiff).toContain('pages');
  });
});
