import { existsSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Journal } from '@/lib/upgrade/migrations';
import { getMigrationStatus, loadJournalFromPath, resolveJournalPath } from '@/lib/upgrade/status';
import { startPostgres, stopPostgres } from '../../helpers/db';

// v0.10.0 D7 — read-only migration status assembly for the admin panel.
// Same harness as migrations.test.ts: a hand-created __drizzle_migrations
// table in the current schema (compareJournalToDb/getMigrationStatus accept
// both that and the default `drizzle` schema), with an INJECTED journal so
// counts are deterministic regardless of how many real migrations exist.

let connectionString = '';

beforeAll(async () => {
  connectionString = await startPostgres();
});

afterAll(async () => {
  await stopPostgres();
});

const JOURNAL: Journal = {
  version: '7',
  dialect: 'postgresql',
  entries: [
    { idx: 0, version: '7', when: 1_700_000_000_000, tag: '0000_init', breakpoints: true },
    { idx: 1, version: '7', when: 1_700_000_001_000, tag: '0001_second', breakpoints: true },
    { idx: 2, version: '7', when: 1_700_000_002_000, tag: '0002_third', breakpoints: true },
  ],
};

type Db = ReturnType<typeof drizzle>;

async function dropMigrationTables(db: Db): Promise<void> {
  // The shared Testcontainers singleton applies the real migrations into the
  // `drizzle` schema; drop BOTH variants so each scenario starts clean.
  await db.execute(sql`DROP TABLE IF EXISTS __drizzle_migrations`);
  await db.execute(sql`DROP TABLE IF EXISTS drizzle.__drizzle_migrations`);
}

async function createMigrationTable(db: Db): Promise<void> {
  await db.execute(sql`
    CREATE TABLE __drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function insertRows(db: Db, createdAts: number[]): Promise<void> {
  for (let i = 0; i < createdAts.length; i++) {
    await db.execute(
      sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${`d7-hash-${i}`}, ${createdAts[i]})`,
    );
  }
}

describe('resolveJournalPath', () => {
  it('returns a real journal path when run from the repo root', async () => {
    const path = resolveJournalPath();
    expect(path).not.toBeNull();
    expect(existsSync(path as string)).toBe(true);
    expect(path).toContain('_journal.json');
    const journal = await loadJournalFromPath(path as string);
    expect(Array.isArray(journal.entries)).toBe(true);
    expect(journal.entries.length).toBeGreaterThan(0);
  });
});

describe('getMigrationStatus', () => {
  it('empty DB (no migrations table): nothing applied, everything pending', async () => {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    try {
      await dropMigrationTables(db);
      const status = await getMigrationStatus(db, JOURNAL);
      expect(status.currentVersion).toBeNull();
      expect(status.appliedCount).toBe(0);
      expect(status.journalCount).toBe(3);
      expect(status.applied).toEqual([]);
      expect(status.pending.map((p) => p.tag)).toEqual(['0000_init', '0001_second', '0002_third']);
      expect(status.drifted).toBe(false);
      expect(status.driftReason).toBeUndefined();
    } finally {
      await client.end();
    }
  });

  it('N rows < journal: first N applied with ISO appliedAt, rest pending, currentVersion = tag[N-1]', async () => {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    try {
      await dropMigrationTables(db);
      await createMigrationTable(db);
      const t0 = 1_716_000_000_000;
      const t1 = 1_716_000_001_000;
      await insertRows(db, [t0, t1]);

      const status = await getMigrationStatus(db, JOURNAL);
      expect(status.appliedCount).toBe(2);
      expect(status.journalCount).toBe(3);
      expect(status.currentVersion).toBe('0001_second');
      expect(status.applied.map((a) => a.tag)).toEqual(['0000_init', '0001_second']);
      // created_at (bigint ms-epoch — number or string depending on driver)
      // is zipped onto the applied entries by index, normalized to ISO.
      expect(status.applied[0]?.appliedAt).toBe(new Date(t0).toISOString());
      expect(status.applied[1]?.appliedAt).toBe(new Date(t1).toISOString());
      expect(status.pending.map((p) => p.tag)).toEqual(['0002_third']);
      expect(status.drifted).toBe(false);
    } finally {
      await client.end();
    }
  });

  it('rows > journal: drifted with a reason naming both counts', async () => {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    try {
      await dropMigrationTables(db);
      await createMigrationTable(db);
      await insertRows(
        db,
        [1_716_000_000_000, 1_716_000_001_000, 1_716_000_002_000, 1_716_000_003_000],
      );

      const status = await getMigrationStatus(db, JOURNAL);
      expect(status.drifted).toBe(true);
      expect(status.driftReason).toContain('4');
      expect(status.driftReason).toContain('3');
      // All journal entries count as applied; nothing is pending under drift.
      expect(status.appliedCount).toBe(3);
      expect(status.pending).toEqual([]);
      expect(status.currentVersion).toBe('0002_third');
    } finally {
      await client.end();
    }
  });
});
