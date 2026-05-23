import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type PendingInvite = {
  id: string;
  email: string;
  role: schema.MemberRole;
  token: string;
  expiresAt: Date;
  createdAt: Date;
};

/**
 * List pending invites for a workspace. "Pending" = not yet consumed
 * (`usedAt IS NULL`) and not yet expired (`expiresAt > now()`).
 *
 * Note: the `invite_tokens` table tracks consumption via a single `usedAt`
 * column — accept and revoke both set it. The semantic distinction (accepted
 * vs revoked) doesn't matter to the admin console, which only cares about
 * which invites are still actionable.
 */
export async function listPendingInvites(db: Db, workspaceId: string): Promise<PendingInvite[]> {
  const rows = await db
    .select({
      id: schema.inviteTokens.id,
      email: schema.inviteTokens.email,
      role: schema.inviteTokens.role,
      token: schema.inviteTokens.token,
      expiresAt: schema.inviteTokens.expiresAt,
      createdAt: schema.inviteTokens.createdAt,
    })
    .from(schema.inviteTokens)
    .where(
      and(
        eq(schema.inviteTokens.workspaceId, workspaceId),
        isNull(schema.inviteTokens.usedAt),
        gt(schema.inviteTokens.expiresAt, sql`now()`),
      ),
    );
  return rows;
}

export type RevokeInviteErrorCode = 'NOT_FOUND';

export class RevokeInviteError extends Error {
  constructor(
    public code: RevokeInviteErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'RevokeInviteError';
  }
}

/**
 * Revoke a pending invite by setting `usedAt = now()`. Only acts on rows that
 * are still pending (not already consumed) and belong to the given workspace —
 * cross-workspace and already-consumed invites both throw NOT_FOUND so we
 * don't leak existence.
 */
export async function revokeInvite(
  db: Db,
  input: { workspaceId: string; inviteId: string },
): Promise<void> {
  const updated = await db
    .update(schema.inviteTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.inviteTokens.id, input.inviteId),
        eq(schema.inviteTokens.workspaceId, input.workspaceId),
        isNull(schema.inviteTokens.usedAt),
      ),
    )
    .returning({ id: schema.inviteTokens.id });
  if (updated.length === 0) {
    throw new RevokeInviteError('NOT_FOUND', 'Invite not found or already consumed');
  }
}
