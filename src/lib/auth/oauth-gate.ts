import { and, eq, gt, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

/**
 * Outcome of evaluating whether an OAuth sign-in should be permitted.
 * - `allow`: the email maps to a user with an existing workspace membership.
 * - `invite`: no membership, but a valid (unused, unexpired) invite exists.
 * - `reject`: neither membership nor a valid invite.
 */
export type OAuthGateDecision =
  | { kind: 'allow'; userId: string }
  | { kind: 'invite'; inviteId: string; workspaceId: string; role: schema.MemberRole }
  | { kind: 'reject'; reason: string };

/**
 * Pure, read-only evaluation of the invite gate for a given email.
 * Does not mutate any state — safe to call from a sign-in callback.
 */
export async function evaluateOAuthGate(
  db: PostgresJsDatabase<typeof schema>,
  email: string,
): Promise<OAuthGateDecision> {
  const normalized = email.toLowerCase();

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, normalized))
    .limit(1);

  if (user) {
    const [membership] = await db
      .select({ workspaceId: schema.workspaceMembers.workspaceId })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, user.id))
      .limit(1);
    if (membership) return { kind: 'allow', userId: user.id };
  }

  const [invite] = await db
    .select()
    .from(schema.inviteTokens)
    .where(
      and(
        eq(schema.inviteTokens.email, normalized),
        isNull(schema.inviteTokens.usedAt),
        gt(schema.inviteTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (invite) {
    return {
      kind: 'invite',
      inviteId: invite.id,
      workspaceId: invite.workspaceId,
      role: invite.role,
    };
  }

  return { kind: 'reject', reason: 'no membership and no valid invite' };
}

/**
 * Apply the invite gate: returns `true` if the sign-in should proceed.
 * For an invited user, atomically consumes the invite and creates the
 * workspace membership inside a transaction. Returns `false` for rejects.
 */
export async function applyOAuthGate(
  db: PostgresJsDatabase<typeof schema>,
  input: { email: string; userId: string },
): Promise<boolean> {
  const decision = await evaluateOAuthGate(db, input.email);

  if (decision.kind === 'allow') return true;
  if (decision.kind === 'reject') return false;

  await db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(schema.inviteTokens)
      .where(and(eq(schema.inviteTokens.id, decision.inviteId), isNull(schema.inviteTokens.usedAt)))
      .limit(1);
    if (!invite) throw new Error('invite no longer available');
    if (invite.expiresAt < new Date()) throw new Error('invite expired');

    await tx
      .update(schema.inviteTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.inviteTokens.id, invite.id));

    await tx
      .insert(schema.workspaceMembers)
      .values({ workspaceId: invite.workspaceId, userId: input.userId, role: invite.role })
      .onConflictDoNothing();
  });
  return true;
}
