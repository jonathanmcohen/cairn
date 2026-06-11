import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { compareJournalToDb, type Journal } from './migrations';

/**
 * v0.10.0 D7 — read-only migration status for the admin panel
 * (/settings/admin/migrations + GET /api/admin/migrations).
 *
 * Deliberately READ-ONLY: the v0.9.17 postmortem rejected in-process migration
 * retry (re-running a half-applied migration hits the duplicate-ALTER trap).
 * This module only REPORTS; recovery is documented guidance (restart for
 * pending, image-roll/restore for drift), never a button.
 */

export type AppliedMigration = {
  idx: number;
  tag: string;
  /** Journal authoring time (ms epoch, from drizzle-kit generate). */
  when: number;
  /** When the row landed in __drizzle_migrations, ISO — null if unknown. */
  appliedAt: string | null;
};

export type PendingMigration = {
  idx: number;
  tag: string;
  when: number;
};

export type MigrationStatus = {
  /** Tag of the last applied journal entry, null when nothing is applied. */
  currentVersion: string | null;
  appliedCount: number;
  journalCount: number;
  applied: AppliedMigration[];
  pending: PendingMigration[];
  drifted: boolean;
  driftReason?: string;
};

/**
 * Locate the bundled `_journal.json` without trusting bare cwd. The CI e2e
 * harness launches the standalone server with cwd INSIDE `.next/standalone/`
 * where `drizzle/` does not exist (the exact resolution bug that broke item
 * C1 on CI) — probe both candidates, same pattern as resolveCliPath in
 * src/lib/backups/jobs.ts. Returns null when neither exists so the route can
 * answer 503 (degraded) instead of crashing the request.
 */
export function resolveJournalPath(): string | null {
  const candidates = [
    join(process.cwd(), 'drizzle', 'migrations', 'meta', '_journal.json'),
    // cwd = .next/standalone (CI e2e harness) → repo root is two levels up.
    join(process.cwd(), '..', '..', 'drizzle', 'migrations', 'meta', '_journal.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Read + parse a journal from an explicit path (resolved above). */
export async function loadJournalFromPath(path: string): Promise<Journal> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as Journal;
  if (!Array.isArray(parsed.entries)) {
    throw new Error('invalid journal: missing entries[]');
  }
  return parsed;
}

/**
 * Drizzle's default migration table stores created_at as a bigint ms-epoch,
 * which the postgres driver may surface as a number OR a string — normalize
 * both to ISO, or null when absent/unparseable.
 */
function toAppliedAtIso(createdAt: number | string | null | undefined): string | null {
  if (createdAt === null || createdAt === undefined) return null;
  const ms = typeof createdAt === 'number' ? createdAt : Number(createdAt);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Assemble the full status: compareJournalToDb's applied/pending/drift split,
 * plus per-row applied timestamps zipped onto the applied entries by index
 * (row hashes are SHAs of the SQL, not comparable to journal tags — insertion
 * order is the join key, same contract compareJournalToDb relies on).
 *
 * Pure and injected (db + journal) so it's unit-testable without HTTP.
 */
export async function getMigrationStatus<S extends Record<string, unknown>>(
  db: PostgresJsDatabase<S>,
  journal: Journal,
): Promise<MigrationStatus> {
  const cmp = await compareJournalToDb({ journal, db });

  // Same schema fallback as compareJournalToDb: drizzle.__drizzle_migrations
  // by default, current_schema() for tests that hand-create the table.
  const tableLocation = (await db.execute(sql`
    SELECT table_schema FROM information_schema.tables
    WHERE table_name = '__drizzle_migrations'
      AND table_schema IN ('drizzle', current_schema())
    ORDER BY CASE WHEN table_schema = 'drizzle' THEN 0 ELSE 1 END
    LIMIT 1
  `)) as unknown as Array<{ table_schema: string }>;

  let rows: Array<{ hash: string; created_at: number | string | null }> = [];
  if (tableLocation[0]) {
    const schema = tableLocation[0].table_schema;
    rows = (await db.execute(
      sql`SELECT hash, created_at FROM ${sql.identifier(schema)}.__drizzle_migrations ORDER BY created_at ASC`,
    )) as unknown as Array<{ hash: string; created_at: number | string | null }>;
  }

  const applied: AppliedMigration[] = cmp.applied.map((entry, i) => ({
    idx: entry.idx,
    tag: entry.tag,
    when: entry.when,
    appliedAt: toAppliedAtIso(rows[i]?.created_at),
  }));
  const pending: PendingMigration[] = cmp.pending.map((entry) => ({
    idx: entry.idx,
    tag: entry.tag,
    when: entry.when,
  }));

  return {
    currentVersion: applied.at(-1)?.tag ?? null,
    appliedCount: applied.length,
    journalCount: journal.entries.length,
    applied,
    pending,
    drifted: cmp.drifted,
    ...(cmp.driftReason !== undefined ? { driftReason: cmp.driftReason } : {}),
  };
}
