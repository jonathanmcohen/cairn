import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { hasMinRole, type MemberRole } from '@/lib/auth/require-role';

type Db = PostgresJsDatabase<typeof schema>;

export type BulkResult = { succeeded: string[]; failed: { id: string; reason: string }[] };

export type BulkCtx = {
  workspaceId: string;
  userId: string;
  role: MemberRole;
  ids: string[];
};

/**
 * Run a per-item mutation over a selection inside one transaction. Each item is
 * attempted independently; failures are collected (partial-failure report)
 * rather than aborting the batch. Permission is checked once up front;
 * per-item workspace ownership is verified inside the SQL predicate so a
 * caller can't sneak cross-workspace ids past the role check.
 */
async function runBulk(
  db: Db,
  ctx: BulkCtx,
  minRole: MemberRole,
  perItem: (tx: Db, id: string) => Promise<void>,
): Promise<BulkResult> {
  if (!hasMinRole(ctx.role, minRole)) {
    throw new Error(`requires role ${minRole}`);
  }
  const result: BulkResult = { succeeded: [], failed: [] };
  await db.transaction(async (tx) => {
    for (const id of ctx.ids) {
      try {
        await perItem(tx as Db, id);
        result.succeeded.push(id);
      } catch (err) {
        result.failed.push({
          id,
          reason: err instanceof Error ? err.message : 'failed',
        });
      }
    }
  });
  return result;
}

/** Soft-delete (trash) each page that belongs to the workspace and is live. */
export async function bulkTrashPages(db: Db, ctx: BulkCtx): Promise<BulkResult> {
  return runBulk(db, ctx, 'editor', async (tx, id) => {
    const updated = await tx
      .update(schema.pages)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(schema.pages.id, id),
          eq(schema.pages.workspaceId, ctx.workspaceId),
          isNull(schema.pages.deletedAt),
        ),
      )
      .returning({ id: schema.pages.id });
    if (updated.length === 0) {
      throw new Error('not found, not in workspace, or already trashed');
    }
  });
}

/** Restore each trashed page in the workspace. */
export async function bulkRestorePages(db: Db, ctx: BulkCtx): Promise<BulkResult> {
  return runBulk(db, ctx, 'editor', async (tx, id) => {
    const updated = await tx
      .update(schema.pages)
      .set({ deletedAt: null })
      .where(
        and(
          eq(schema.pages.id, id),
          eq(schema.pages.workspaceId, ctx.workspaceId),
          isNotNull(schema.pages.deletedAt),
        ),
      )
      .returning({ id: schema.pages.id });
    if (updated.length === 0) {
      throw new Error('not found, not in workspace, or not trashed');
    }
  });
}

/** Move each page under a new parent (or to root when parentId is null). */
export async function bulkMovePages(
  db: Db,
  ctx: BulkCtx & { parentId: string | null },
): Promise<BulkResult> {
  return runBulk(db, ctx, 'editor', async (tx, id) => {
    if (ctx.parentId !== null && ctx.ids.includes(ctx.parentId)) {
      throw new Error('cannot move a page under itself');
    }
    const updated = await tx
      .update(schema.pages)
      .set({ parentId: ctx.parentId })
      .where(and(eq(schema.pages.id, id), eq(schema.pages.workspaceId, ctx.workspaceId)))
      .returning({ id: schema.pages.id });
    if (updated.length === 0) throw new Error('not found or not in workspace');
  });
}
