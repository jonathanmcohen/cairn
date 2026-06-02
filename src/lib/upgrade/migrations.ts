import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

export type Journal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

const JOURNAL_PATH = join(process.cwd(), 'drizzle', 'migrations', 'meta', '_journal.json');

/**
 * Read the bundled Drizzle migration journal that ships with the runtime
 * image. This is the same file the production `src/db/migrate.ts` walks at
 * startup, so a comparator anchored on this file is by-definition aligned
 * with what the running code expects.
 */
export async function loadBundledJournal(): Promise<Journal> {
  const raw = await readFile(JOURNAL_PATH, 'utf8');
  const parsed = JSON.parse(raw) as Journal;
  if (!Array.isArray(parsed.entries)) {
    throw new Error('invalid journal: missing entries[]');
  }
  return parsed;
}

export type CompareResult = {
  applied: JournalEntry[];
  pending: JournalEntry[];
  drifted: boolean;
  driftReason?: string;
};

/**
 * Compare the bundled journal to the live `__drizzle_migrations` table.
 *
 * Drizzle's row.hash is a SHA of the migration SQL and the journal's `tag`
 * is the filename (e.g. "0034_sso_tables") -- the two are not directly
 * comparable. We use the row count + insertion order as the gate:
 *
 * - applied count > journal length         -> drift (DB ahead of bundle)
 * - applied count == 0                     -> nothing applied yet
 * - applied count <= journal length        -> first N journal entries applied
 *
 * The compare helper deliberately does NOT throw on drift; healthcheck and
 * preview interpret the result.
 */
export async function compareJournalToDb<S extends Record<string, unknown>>(input: {
  journal: Journal;
  db: PostgresJsDatabase<S>;
}): Promise<CompareResult> {
  // Drizzle stores its migration metadata in the `drizzle` schema by default
  // (`drizzle.__drizzle_migrations`). For test scenarios that hand-create the
  // table in the current schema we also accept that location.
  const tableLocation = (await input.db.execute(sql`
    SELECT table_schema FROM information_schema.tables
    WHERE table_name = '__drizzle_migrations'
      AND table_schema IN ('drizzle', current_schema())
    ORDER BY CASE WHEN table_schema = 'drizzle' THEN 0 ELSE 1 END
    LIMIT 1
  `)) as unknown as Array<{ table_schema: string }>;

  if (!tableLocation[0]) {
    return { applied: [], pending: [...input.journal.entries], drifted: false };
  }

  const schema = tableLocation[0].table_schema;
  const rows = (await input.db.execute(
    sql`SELECT hash, created_at FROM ${sql.identifier(schema)}.__drizzle_migrations ORDER BY created_at ASC`,
  )) as unknown as Array<{ hash: string; created_at: number | string }>;

  const dbHashes = rows.map((r) => r.hash);
  const applied = input.journal.entries.slice(0, dbHashes.length);
  const pending = input.journal.entries.slice(dbHashes.length);
  const drifted = dbHashes.length > input.journal.entries.length;
  const driftReason = drifted
    ? `database has ${dbHashes.length} migrations applied but journal lists ${input.journal.entries.length}`
    : undefined;
  if (dbHashes.some((h) => !h || typeof h !== 'string')) {
    return {
      applied,
      pending,
      drifted: true,
      driftReason: 'unparseable hash in __drizzle_migrations',
    };
  }
  return { applied, pending, drifted, driftReason };
}

/**
 * #1 (P0) — fail-loud guard for the boot path. `migrate()` applies pending
 * migrations, but the v0.9.4 outage was a SILENT skip: the migrator resolved
 * the wrong folder, found zero pending migrations, printed success, and served
 * a half-migrated DB (every workspace fetch then 42703'd on the missing
 * `workspaces.icon`). This guard runs AFTER migrate() and THROWS if the live
 * `__drizzle_migrations` table still trails the bundled journal (pending) or
 * is ahead of it (drift) — turning a silent half-migration into a loud,
 * non-zero-exit boot failure rather than a degraded serving DB.
 */
export async function assertNoPendingMigrations<S extends Record<string, unknown>>(input: {
  journal: Journal;
  db: PostgresJsDatabase<S>;
}): Promise<void> {
  const result = await compareJournalToDb(input);
  if (result.pending.length > 0) {
    throw new Error(
      `FATAL: ${result.pending.length} pending migration(s) after migrate() — ` +
        `the database is half-migrated (first pending: ${result.pending[0]?.tag}). ` +
        'Refusing to serve a half-migrated database.',
    );
  }
  if (result.drifted) {
    throw new Error(
      `FATAL: migration drift detected — ${result.driftReason ?? 'database is ahead of the bundled journal'}. ` +
        'Refusing to serve a drifted database.',
    );
  }
}
