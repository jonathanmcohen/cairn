import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import type { Journal } from '@/lib/upgrade/migrations';
import { assertNoPendingMigrations } from '@/lib/upgrade/migrations';

// `assertNoPendingMigrations` only ever calls `db.execute(...)`. We fake it
// rather than spinning up Testcontainers because the shared test container
// already owns a fully-applied `drizzle.__drizzle_migrations`, which would mask
// the hand-crafted pending/drift scenarios. The fake answers the two queries
// `compareJournalToDb` issues: (1) locate the metadata table, (2) read its rows.
function fakeDb(appliedCount: number): PostgresJsDatabase<Record<string, never>> {
  let call = 0;
  return {
    execute: async () => {
      call += 1;
      if (call === 1) {
        // table-location probe → found in current schema
        return [{ table_schema: 'public' }] as unknown as never;
      }
      // rows of __drizzle_migrations
      return Array.from({ length: appliedCount }, (_, i) => ({
        hash: `h${i}`,
        created_at: i,
      })) as unknown as never;
    },
  } as unknown as PostgresJsDatabase<Record<string, never>>;
}

function journal(n: number): Journal {
  return {
    version: '7',
    dialect: 'postgresql',
    entries: Array.from({ length: n }, (_, i) => ({
      idx: i,
      version: '7',
      when: i,
      tag: `${String(i).padStart(4, '0')}_m`,
      breakpoints: true,
    })),
  };
}

describe('assertNoPendingMigrations (#1 — fail-loud)', () => {
  it('throws when the DB has fewer applied migrations than the bundled journal', async () => {
    await expect(assertNoPendingMigrations({ journal: journal(3), db: fakeDb(1) })).rejects.toThrow(
      /pending migration/i,
    );
  });

  it('does not throw when every journal entry is applied', async () => {
    await expect(
      assertNoPendingMigrations({ journal: journal(3), db: fakeDb(3) }),
    ).resolves.toBeUndefined();
  });

  it('throws when the DB is ahead of the bundle (drift)', async () => {
    await expect(assertNoPendingMigrations({ journal: journal(3), db: fakeDb(4) })).rejects.toThrow(
      /drift/i,
    );
  });

  it('throws when no migrations are applied at all but the journal is non-empty', async () => {
    await expect(assertNoPendingMigrations({ journal: journal(2), db: fakeDb(0) })).rejects.toThrow(
      /pending migration/i,
    );
  });
});
