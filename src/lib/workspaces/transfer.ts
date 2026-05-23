import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

export type TransferErrorCode = 'NOT_OWNER' | 'TARGET_NOT_MEMBER' | 'SAME_USER';

/**
 * Typed transfer-ownership error. Carries a stable `code` so API routes can
 * map it to an HTTP status without string-matching `.message`.
 */
export class TransferError extends Error {
  constructor(
    public code: TransferErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'TransferError';
  }
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Promote `toUserId` to `owner` and demote `fromUserId` (the current owner)
 * to `admin`. Both updates AND the audit row are written in a single
 * transaction so a workspace never lands with zero — or two — owners and the
 * audit can never drift from the action (spec §2.27).
 *
 * Refuses:
 * - `SAME_USER` — actor cannot transfer to themselves.
 * - `NOT_OWNER` — actor isn't the current owner (the route also gates this
 *   via `requireRole('admin')` + an explicit `ctx.role === 'owner'` check,
 *   but the helper trusts no caller).
 * - `TARGET_NOT_MEMBER` — target isn't a member of the workspace.
 */
export async function transferOwnership(
  db: Db,
  input: { workspaceId: string; fromUserId: string; toUserId: string },
): Promise<void> {
  if (input.fromUserId === input.toUserId) {
    throw new TransferError('SAME_USER', 'Cannot transfer to yourself');
  }
  await db.transaction(async (tx) => {
    const [actor] = await tx
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, input.workspaceId),
          eq(schema.workspaceMembers.userId, input.fromUserId),
        ),
      );
    if (actor?.role !== 'owner') throw new TransferError('NOT_OWNER');

    const [target] = await tx
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, input.workspaceId),
          eq(schema.workspaceMembers.userId, input.toUserId),
        ),
      );
    if (!target) throw new TransferError('TARGET_NOT_MEMBER');

    // Promote target -> owner.
    await tx
      .update(schema.workspaceMembers)
      .set({ role: 'owner' })
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, input.workspaceId),
          eq(schema.workspaceMembers.userId, input.toUserId),
        ),
      );
    // Demote old owner -> admin.
    await tx
      .update(schema.workspaceMembers)
      .set({ role: 'admin' })
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, input.workspaceId),
          eq(schema.workspaceMembers.userId, input.fromUserId),
        ),
      );

    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.fromUserId,
      action: 'workspace.ownership_transferred',
      targetType: 'workspace',
      targetId: input.workspaceId,
      metadata: { fromUserId: input.fromUserId, toUserId: input.toUserId },
    });
  });
}
