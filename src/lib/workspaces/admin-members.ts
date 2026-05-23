import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type AdminMemberErrorCode =
  | 'CANNOT_SET_OWNER'
  | 'CANNOT_REMOVE_OWNER'
  | 'LAST_OWNER'
  | 'CANNOT_REMOVE_SELF';

/**
 * Typed admin-member error. Carries a stable `code` so API routes can map it to
 * an HTTP status without string-matching `.message`.
 */
export class AdminMemberError extends Error {
  constructor(
    public code: AdminMemberErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AdminMemberError';
  }
}

type Db = PostgresJsDatabase<typeof schema>;

export type AdminMember = {
  userId: string;
  name: string;
  email: string;
  role: schema.MemberRole;
};

/** All members of a workspace, joined with user name+email for admin listings. */
export async function listWorkspaceMembers(db: Db, workspaceId: string): Promise<AdminMember[]> {
  const rows = await db
    .select({
      userId: schema.workspaceMembers.userId,
      role: schema.workspaceMembers.role,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
  return rows.map((r) => ({ userId: r.userId, name: r.name, email: r.email, role: r.role }));
}

async function ownerCount(db: Db, workspaceId: string): Promise<number> {
  const rows = await db
    .select({ userId: schema.workspaceMembers.userId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.role, 'owner'),
      ),
    );
  return rows.length;
}

/**
 * Change a member's role.
 *
 * Refuses:
 * - promotion to 'owner' (`CANNOT_SET_OWNER`) — use transfer-ownership instead.
 * - demoting the last owner (`LAST_OWNER`) — a workspace must always have one.
 *
 * The actor's authority (owner/admin) is enforced by `requireRole` at the route
 * layer; this helper trusts the caller.
 */
export async function setMemberRole(
  db: Db,
  input: {
    workspaceId: string;
    actorUserId: string;
    targetUserId: string;
    role: schema.MemberRole;
  },
): Promise<void> {
  if (input.role === 'owner') {
    throw new AdminMemberError('CANNOT_SET_OWNER', 'Use transfer ownership');
  }
  // If we're demoting an existing owner, ensure another owner remains so we
  // never strand a workspace with zero owners.
  const [target] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, input.workspaceId),
        eq(schema.workspaceMembers.userId, input.targetUserId),
      ),
    );
  if (target?.role === 'owner') {
    const owners = await ownerCount(db, input.workspaceId);
    if (owners <= 1) throw new AdminMemberError('LAST_OWNER');
  }
  await db
    .update(schema.workspaceMembers)
    .set({ role: input.role })
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, input.workspaceId),
        eq(schema.workspaceMembers.userId, input.targetUserId),
      ),
    );
}

/**
 * Remove a non-owner member from a workspace.
 *
 * Refuses:
 * - removing an owner (`CANNOT_REMOVE_OWNER`) — transfer ownership first.
 * - the actor removing themselves (`CANNOT_REMOVE_SELF`) — use the leave flow.
 */
export async function removeMember(
  db: Db,
  input: { workspaceId: string; actorUserId: string; targetUserId: string },
): Promise<void> {
  if (input.actorUserId === input.targetUserId) {
    throw new AdminMemberError('CANNOT_REMOVE_SELF');
  }
  const [target] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, input.workspaceId),
        eq(schema.workspaceMembers.userId, input.targetUserId),
      ),
    );
  if (target?.role === 'owner') {
    throw new AdminMemberError('CANNOT_REMOVE_OWNER');
  }
  await db
    .delete(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, input.workspaceId),
        eq(schema.workspaceMembers.userId, input.targetUserId),
      ),
    );
}
