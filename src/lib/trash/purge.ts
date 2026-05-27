/**
 * v0.9.0 G2 P13 — Trash retention purge.
 *
 * Given a workspace + retention-days, hard-delete every trash-rooted page whose
 * `deleted_at` is older than the cutoff, recursively collect descendant page
 * ids, delete attached file blobs through the configured `FileStorage`, and
 * record a single audit row summarizing the run. Same helper backs both the
 * daily cron (`reason: 'auto'`) and the admin "Empty trash now" button
 * (`reason: 'manual'`, `retentionDays: 0` → everything in trash, ignoring age).
 *
 * Idempotent: if a previous invocation crashed after the page-delete but
 * before the blob-delete step, the next call simply finds no rows to purge —
 * orphan blobs are reclaimed by the v0.6 P9 weekly sweeper.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { getStorage } from '@/lib/files/get-storage';

export type PurgeReason = 'auto' | 'manual';

export type PurgeResult = {
  purgedCount: number;
  purgedPageIds: string[];
  descendantsCount: number;
  bytesReclaimed: number;
};

export async function purgeWorkspaceTrash(
  db: PostgresJsDatabase<typeof schema>,
  input: { workspaceId: string; retentionDays: number; reason: PurgeReason },
): Promise<PurgeResult> {
  const { workspaceId, retentionDays, reason } = input;

  // 1. Find trash-root pages older than the cutoff. retentionDays=0 means
  //    "everything in trash, regardless of age" (manual empty-trash flow).
  const rootRows = (await db.execute(sql`
    SELECT id FROM pages
     WHERE workspace_id = ${workspaceId}
       AND deleted_at IS NOT NULL
       AND deleted_root = true
       AND deleted_at < now() - (${String(retentionDays)} || ' days')::interval
  `)) as unknown as Array<{ id: string }>;

  if (rootRows.length === 0) {
    return { purgedCount: 0, purgedPageIds: [], descendantsCount: 0, bytesReclaimed: 0 };
  }

  const rootIds = rootRows.map((r) => r.id);
  // Defense-in-depth: all ids come from a `SELECT id FROM pages` so they're
  // already validated uuids — but a runtime check makes the `sql.raw` below
  // unambiguously safe to anyone reading the code.
  for (const id of rootIds) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new Error(`purgeWorkspaceTrash: invalid uuid in rootIds: ${id}`);
    }
  }
  const rootIdsLiteral = sql.raw(
    `ARRAY[${rootIds.map((id) => `'${id}'::uuid`).join(',')}]::uuid[]`,
  );

  // 2. Recursively walk descendants so attachments hanging off non-root trash
  //    rows still get cleaned up. Drizzle can't express CTEs — raw SQL.
  const descendantRows = (await db.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM pages WHERE id = ANY(${rootIdsLiteral})
      UNION
      SELECT p.id FROM pages p JOIN descendants d ON p.parent_id = d.id
    )
    SELECT id FROM descendants
  `)) as unknown as Array<{ id: string }>;
  const allPageIds = descendantRows.map((r) => r.id);
  for (const id of allPageIds) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new Error(`purgeWorkspaceTrash: invalid uuid in allPageIds: ${id}`);
    }
  }
  const allIdsLiteral = sql.raw(
    `ARRAY[${allPageIds.map((id) => `'${id}'::uuid`).join(',')}]::uuid[]`,
  );

  // 3. Resolve file blobs attached to anything we're about to delete so we can
  //    drop them from storage after the DB rows are gone. DB row delete is the
  //    source of truth — if a blob delete fails the rows are still gone and
  //    the orphan blob sweeper reclaims it.
  const fileRows = (await db.execute(sql`
    SELECT id, path, size FROM files WHERE page_id = ANY(${allIdsLiteral})
  `)) as unknown as Array<{ id: string; path: string; size: number | string }>;
  const bytesReclaimed = fileRows.reduce((acc, f) => acc + Number(f.size ?? 0), 0);

  // 4. Delete the pages themselves. There are no DB-level FK cascades against
  //    `pages`, so a single DELETE on all collected ids works regardless of
  //    parent/child ordering (deferred constraints not needed).
  await db.execute(sql`DELETE FROM pages WHERE id = ANY(${allIdsLiteral})`);

  // 5. Delete blobs best-effort. We swallow per-file errors so a single bad
  //    blob doesn't strand the rest of the purge — the orphan sweeper will
  //    pick up anything we missed.
  if (fileRows.length > 0) {
    const storage = getStorage();
    for (const file of fileRows) {
      try {
        await storage.delete(file.path);
      } catch (err) {
        console.warn('[trash:purge] blob delete failed', { fileId: file.id, err });
      }
    }
  }

  // 6. One summary audit row per invocation — no page ids in metadata to keep
  //    the log compact and avoid leaking trash contents.
  await recordAudit(db, {
    workspaceId,
    actorUserId: null,
    action: reason === 'auto' ? 'trash.purged_auto' : 'trash.purged_manual',
    targetType: 'workspace',
    targetId: workspaceId,
    metadata: {
      count: rootIds.length,
      descendantsCount: allPageIds.length,
      bytesReclaimed,
      retentionDays,
    },
  });

  return {
    purgedCount: rootIds.length,
    purgedPageIds: rootIds,
    descendantsCount: allPageIds.length,
    bytesReclaimed,
  };
}
