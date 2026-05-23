import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

export type DeleteWorkspaceErrorCode = 'NOT_OWNER' | 'NOT_FOUND';

/**
 * Typed delete-workspace error. Carries a stable `code` so API routes can
 * map it to an HTTP status without string-matching `.message`.
 */
export class DeleteWorkspaceError extends Error {
  constructor(
    public code: DeleteWorkspaceErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DeleteWorkspaceError';
  }
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Delete a workspace and (via FK cascades on `workspaces.id`) everything
 * scoped to it — members, pages, databases, files metadata, comments, audit
 * log, etc.
 *
 * Refuses:
 * - `NOT_FOUND` — actor isn't a member of the workspace (returned in place
 *   of 403 by the route layer if it routes here at all; the route also gates
 *   `requireRole('admin')` + an explicit owner check first).
 * - `NOT_OWNER` — actor is a member but not the owner.
 *
 * AUDIT-ON-DELETE NOTE: `audit_log.workspace_id` has `ON DELETE CASCADE`, so
 * the `workspace.deleted` row recorded here is removed alongside the
 * workspace it describes. The call is kept for contract symmetry — every
 * sensitive helper must call `recordAudit` (spec §2.27). Cross-workspace
 * audit persistence is out of scope for P17; if a future plan needs to keep
 * a tombstone, it would require a schema migration to flip the FK to
 * `SET NULL` (column is currently `notNull`).
 */
export async function deleteWorkspace(
  db: Db,
  input: { workspaceId: string; actorUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [actor] = await tx
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, input.workspaceId),
          eq(schema.workspaceMembers.userId, input.actorUserId),
        ),
      );
    if (!actor) throw new DeleteWorkspaceError('NOT_FOUND');
    if (actor.role !== 'owner') throw new DeleteWorkspaceError('NOT_OWNER');

    // Symbolic audit — see AUDIT-ON-DELETE NOTE above.
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'workspace.deleted',
      targetType: 'workspace',
      targetId: input.workspaceId,
    });

    await tx.delete(schema.workspaces).where(eq(schema.workspaces.id, input.workspaceId));
  });
}
