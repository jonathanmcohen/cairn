import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { emit } from '@/lib/webhooks/dispatch';

export type SoftDeleteInput = {
  pageId: string;
  workspaceId: string;
  actorUserId: string;
};

/**
 * Soft-delete a page and its descendants. The mutation + the `page.deleted`
 * audit row are written in a single transaction so the audit can never drift
 * from the action (spec §2.27).
 */
export async function softDeletePage(
  db: PostgresJsDatabase<typeof schema>,
  input: SoftDeleteInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Verify the page exists in this workspace and is not already deleted.
    const target = (await tx.execute(rawSql`
      SELECT id FROM pages
      WHERE id = ${input.pageId}
        AND workspace_id = ${input.workspaceId}
        AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as { id: string }[];
    if (target.length === 0) throw new Error('Page not found');

    // Recursive CTE: collect target + all descendants, mark them deleted.
    await tx.execute(rawSql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM pages WHERE id = ${input.pageId}
        UNION ALL
        SELECT p.id FROM pages p
        INNER JOIN descendants d ON p.parent_id = d.id
        WHERE p.deleted_at IS NULL
      )
      UPDATE pages
      SET deleted_at = now(),
          deleted_root = (id = ${input.pageId})
      WHERE id IN (SELECT id FROM descendants)
    `);

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'page.deleted',
      targetType: 'page',
      targetId: input.pageId,
    });
  });
  // Fire-and-forget webhook (self-guarding; never throws into the caller).
  void emit('page.deleted', input.workspaceId, { id: input.pageId });
}
