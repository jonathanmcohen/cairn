/**
 * v0.9.8 G4 (H) — Orphan-empty-Untitled page sweep.
 *
 * Selects pages that are simultaneously the default title ('Untitled'), have
 * empty extracted text (content_text = ''), are not already trashed
 * (deleted_at IS NULL), are childless (no row points at them via parent_id),
 * and are older than `olderThanDays`. `dryRun` lists candidates without
 * mutating; otherwise each candidate is soft-deleted by setting deleted_at.
 *
 * Reads existing columns only — no migration. Exposed as a pure function (a
 * Drizzle db in, a summary out) so tests can drive it directly without
 * spawning the CLI child process, mirroring `runAutoUnlockSweep`.
 *
 * The selection + soft-delete run inside a single transaction with the
 * candidate rows locked FOR UPDATE so a concurrent edit (which would clear the
 * Untitled/empty condition) can't race the delete.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';

export type OrphanPurgeCandidate = {
  pageId: string;
  workspaceId: string;
};

export type OrphanPurgeResult = {
  candidates: OrphanPurgeCandidate[];
  purgedCount: number;
};

export type OrphanPurgeOptions = {
  olderThanDays: number;
  dryRun: boolean;
};

export async function runOrphanPurge(
  db: PostgresJsDatabase<typeof schema>,
  opts: OrphanPurgeOptions,
): Promise<OrphanPurgeResult> {
  const olderThan = String(opts.olderThanDays);
  return db.transaction(async (tx) => {
    const candidates = (await tx.execute(sql`
      SELECT id AS page_id, workspace_id
        FROM pages
       WHERE title = 'Untitled'
         AND content_text = ''
         AND deleted_at IS NULL
         AND id NOT IN (SELECT parent_id FROM pages WHERE parent_id IS NOT NULL)
         AND created_at < now() - (${olderThan}::text || ' days')::interval
       FOR UPDATE
    `)) as unknown as Array<{ page_id: string; workspace_id: string }>;

    const mapped = candidates.map((r) => ({ pageId: r.page_id, workspaceId: r.workspace_id }));

    if (opts.dryRun || mapped.length === 0) {
      return { candidates: mapped, purgedCount: 0 };
    }

    await tx.execute(sql`
      UPDATE pages
         SET deleted_at = now()
       WHERE title = 'Untitled'
         AND content_text = ''
         AND deleted_at IS NULL
         AND id NOT IN (SELECT parent_id FROM pages WHERE parent_id IS NOT NULL)
         AND created_at < now() - (${olderThan}::text || ' days')::interval
    `);

    return { candidates: mapped, purgedCount: mapped.length };
  });
}
