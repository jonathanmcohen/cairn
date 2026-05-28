import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import { runHealthcheck } from '@/lib/upgrade/healthcheck';
import { startPostgres, stopPostgres } from '../../helpers/db';

let connectionString = '';

beforeAll(async () => {
  connectionString = await startPostgres();
  await runMigrations(connectionString);
});

afterAll(async () => {
  await stopPostgres();
});

beforeEach(async () => {
  // Reset any test-injected drift rows in the drizzle.__drizzle_migrations
  // table (which is what compareJournalToDb actually reads). We keep the
  // baseline rows that `runMigrations` wrote and only purge phantoms.
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  try {
    await db.execute(sql`DELETE FROM drizzle.__drizzle_migrations WHERE hash LIKE 'phantom-%'`);
  } finally {
    await client.end();
  }
});

describe('runHealthcheck', () => {
  it('returns ok when /api/health is 200 and journal matches db', async () => {
    const result = await runHealthcheck({
      databaseUrl: connectionString,
      healthcheck: async () => ({ ok: true, version: '0.9.0' }),
    });
    expect(result.ok).toBe(true);
    expect(result.drift).toBe(false);
  });

  it('fails when /api/health returns non-200', async () => {
    const result = await runHealthcheck({
      databaseUrl: connectionString,
      healthcheck: async () => ({ ok: false, version: '0.9.0' }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/health/i);
  });

  it('flags drift when __drizzle_migrations row count exceeds journal length', async () => {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    try {
      // Append 100 phantom rows to drizzle.__drizzle_migrations (the table
      // Drizzle uses by default) so the count exceeds the journal length.
      for (let i = 0; i < 100; i++) {
        await db.execute(
          sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${'phantom-' + i}, ${Date.now()})`,
        );
      }
    } finally {
      await client.end();
    }
    const result = await runHealthcheck({
      databaseUrl: connectionString,
      healthcheck: async () => ({ ok: true, version: '0.9.0' }),
    });
    expect(result.ok).toBe(false);
    expect(result.drift).toBe(true);
  });
});
