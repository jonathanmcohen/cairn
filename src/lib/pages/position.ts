import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';

/**
 * v0.10.2 S8 — sibling-position gap numbering for the pages tree.
 *
 * Positions are scoped to (workspace_id, parent_id) and spaced POSITION_GAP
 * apart (backfilled by 0076_page_position.sql; `createPage` appends at
 * max + POSITION_GAP). A move bisects the gap between its two neighbors; when
 * a gap closes below 1 the whole sibling group is renumbered back to *1024 by
 * {@link renumberSiblingPositions} and the midpoint is recomputed once.
 */
export const POSITION_GAP = 1024;

export type SiblingPosition = { id: string; position: number };

export type InsertAnchor = {
  /** Insert the moved page immediately BEFORE this sibling id. */
  beforeId?: string | null;
  /** Insert the moved page immediately AFTER this sibling id. */
  afterId?: string | null;
};

/**
 * Compute the new position for a page inserted among `siblings` (the target
 * parent's children in (position ASC, createdAt ASC) order, EXCLUDING the page
 * being moved). Returns `null` when the gap between the two neighbors has
 * closed (< 2 apart) — the caller renumbers the group and retries.
 *
 * No anchor → append at end (max + POSITION_GAP). An anchor id that is not in
 * `siblings` throws: the client sent a stale/foreign sibling reference.
 */
export function computeInsertPosition(
  siblings: readonly SiblingPosition[],
  anchor: InsertAnchor,
): number | null {
  if (anchor.beforeId && anchor.afterId) {
    throw new Error('Provide at most one of beforeId/afterId');
  }
  let prev: number | null = null;
  let next: number | null = null;
  if (anchor.beforeId) {
    const idx = siblings.findIndex((s) => s.id === anchor.beforeId);
    if (idx === -1) throw new Error('beforeId is not a sibling under the new parent');
    next = siblings[idx]?.position ?? null;
    prev = idx > 0 ? (siblings[idx - 1]?.position ?? null) : null;
  } else if (anchor.afterId) {
    const idx = siblings.findIndex((s) => s.id === anchor.afterId);
    if (idx === -1) throw new Error('afterId is not a sibling under the new parent');
    prev = siblings[idx]?.position ?? null;
    next = siblings[idx + 1]?.position ?? null;
  } else {
    prev = siblings.length > 0 ? (siblings[siblings.length - 1]?.position ?? null) : null;
  }

  if (prev === null && next === null) return POSITION_GAP;
  if (next === null && prev !== null) return prev + POSITION_GAP;
  if (prev === null && next !== null) {
    // Inserting at the head: bisect (0, next).
    return next >= 2 ? Math.floor(next / 2) : null;
  }
  if (prev !== null && next !== null) {
    const mid = prev + Math.floor((next - prev) / 2);
    return mid > prev && mid < next ? mid : null;
  }
  return null;
}

/** Minimal executor so the helper accepts both the db and a transaction handle. */
type SqlExecutor = Pick<PostgresJsDatabase<typeof schema>, 'execute'>;

/**
 * Renumber every non-deleted child of (workspaceId, parentId) to
 * row_number * POSITION_GAP, preserving the current (position, created_at)
 * order. `IS NOT DISTINCT FROM` folds the NULL-parent (root) group in. Runs
 * inside the caller's transaction.
 */
export async function renumberSiblingPositions(
  tx: SqlExecutor,
  workspaceId: string,
  parentId: string | null,
): Promise<void> {
  await tx.execute(rawSql`
    WITH ordered AS (
      SELECT id, (row_number() OVER (ORDER BY position ASC, created_at ASC)) * ${POSITION_GAP} AS pos
      FROM pages
      WHERE workspace_id = ${workspaceId}
        AND parent_id IS NOT DISTINCT FROM ${parentId}
        AND deleted_at IS NULL
    )
    UPDATE pages SET position = ordered.pos
    FROM ordered
    WHERE pages.id = ordered.id
  `);
}
