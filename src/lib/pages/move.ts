import { and, asc, eq, isNull, ne, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { requireUnlocked } from '@/lib/pages/lock';
import { computeInsertPosition, renumberSiblingPositions } from '@/lib/pages/position';

export type MovePageInput = {
  pageId: string;
  workspaceId: string;
  newParentId: string | null;
  // v0.10.2 S8 — optional ordering anchor among the new parent's children.
  // At most one of the two; both omitted = append at the end of the sibling
  // group (gap-numbered max + POSITION_GAP).
  /** Insert the moved page immediately BEFORE this sibling id. */
  beforeId?: string | null;
  /** Insert the moved page immediately AFTER this sibling id. */
  afterId?: string | null;
  // v0.9.0 G2 P14 — page-lock gate.
  byUserId: string;
  adminOverride: boolean;
};

export async function movePage(
  db: PostgresJsDatabase<typeof schema>,
  input: MovePageInput,
): Promise<void> {
  if (input.newParentId === input.pageId) {
    throw new Error('Cannot move a page under itself (cycle)');
  }
  if (input.beforeId && input.afterId) {
    throw new Error('Provide at most one sibling anchor (beforeId or afterId)');
  }

  await requireUnlocked(db, {
    pageId: input.pageId,
    byUserId: input.byUserId,
    adminOverride: input.adminOverride,
  });

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, input.pageId),
          eq(schema.pages.workspaceId, input.workspaceId),
          isNull(schema.pages.deletedAt),
        ),
      )
      .limit(1);
    if (!target) throw new Error('Page not found');

    if (input.newParentId) {
      const [parent] = await tx
        .select()
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, input.newParentId),
            eq(schema.pages.workspaceId, input.workspaceId),
            isNull(schema.pages.deletedAt),
          ),
        )
        .limit(1);
      if (!parent) throw new Error('Parent page is missing or in a different workspace');

      // Cycle check: is the new parent in the target's descendant subtree?
      const result = (await tx.execute(rawSql`
        WITH RECURSIVE descendants AS (
          SELECT id FROM pages WHERE id = ${input.pageId}
          UNION ALL
          SELECT p.id FROM pages p
          INNER JOIN descendants d ON p.parent_id = d.id
        )
        SELECT count(*)::int AS count FROM descendants WHERE id = ${input.newParentId}
      `)) as unknown as { count: number }[];
      const count = Number(result[0]?.count ?? 0);
      if (count > 0) throw new Error('Cycle detected: new parent is a descendant of the target');
    }

    // v0.10.2 S8 — compute the moved page's position among the new parent's
    // children (excluding itself). beforeId/afterId bisect the neighbor gap;
    // no anchor = append at end. When the gap has closed (< 2 apart) the
    // sibling group is renumbered back to *POSITION_GAP once and the midpoint
    // recomputed — gaps are then >= POSITION_GAP, so the retry cannot fail.
    const siblingWhere = and(
      eq(schema.pages.workspaceId, input.workspaceId),
      input.newParentId
        ? eq(schema.pages.parentId, input.newParentId)
        : isNull(schema.pages.parentId),
      isNull(schema.pages.deletedAt),
      ne(schema.pages.id, input.pageId),
    );
    const readSiblings = () =>
      tx
        .select({ id: schema.pages.id, position: schema.pages.position })
        .from(schema.pages)
        .where(siblingWhere)
        .orderBy(asc(schema.pages.position), asc(schema.pages.createdAt));
    const anchor = { beforeId: input.beforeId ?? null, afterId: input.afterId ?? null };
    let position = computeInsertPosition(await readSiblings(), anchor);
    if (position === null) {
      await renumberSiblingPositions(tx, input.workspaceId, input.newParentId);
      position = computeInsertPosition(await readSiblings(), anchor);
    }
    if (position === null) {
      throw new Error('Could not compute a sibling position after renumbering');
    }

    await tx
      .update(schema.pages)
      .set({ parentId: input.newParentId, position })
      .where(eq(schema.pages.id, input.pageId));
  });
}
