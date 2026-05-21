import * as schema from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type LeaveErrorCode = 'NOT_MEMBER' | 'SOLE_OWNER';

export class LeaveError extends Error {
  constructor(
    public code: LeaveErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Remove a user's own membership from a workspace.
 * Rejects (SOLE_OWNER) if the caller is the only owner — no transfer/delete in v0.2.0.
 * Rejects (NOT_MEMBER) if the caller is not a member.
 */
export async function leaveWorkspace(
  db: PostgresJsDatabase<typeof schema>,
  input: { workspaceId: string; userId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const members = await tx
      .select({ userId: schema.workspaceMembers.userId, role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, input.workspaceId));

    const me = members.find((m) => m.userId === input.userId);
    if (!me) throw new LeaveError('NOT_MEMBER', 'Not a member of that workspace');

    if (me.role === 'owner') {
      const owners = members.filter((m) => m.role === 'owner');
      if (owners.length === 1) {
        throw new LeaveError(
          'SOLE_OWNER',
          'You are the only owner. Transfer ownership before leaving (not yet supported in this version).',
        );
      }
    }

    await tx
      .delete(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, input.workspaceId),
          eq(schema.workspaceMembers.userId, input.userId),
        ),
      );
  });
}
