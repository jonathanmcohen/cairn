import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type AcceptInviteErrorCode = 'NOT_FOUND' | 'USED' | 'EXPIRED' | 'EMAIL_MISMATCH';

export class AcceptInviteError extends Error {
  constructor(
    public code: AcceptInviteErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type AcceptInviteResult = { workspaceId: string; role: schema.MemberRole };

/**
 * Accept an invite for an already-authenticated user.
 * Validates the token (exists, unused, unexpired) and that the invite email
 * matches the user's email, then adds the membership and consumes the token.
 */
export async function acceptInvite(
  db: PostgresJsDatabase<typeof schema>,
  input: { token: string; userId: string; userEmail: string },
): Promise<AcceptInviteResult> {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(schema.inviteTokens)
      .where(eq(schema.inviteTokens.token, input.token))
      .limit(1);
    if (!invite) throw new AcceptInviteError('NOT_FOUND', 'Invalid invite token');
    if (invite.usedAt) throw new AcceptInviteError('USED', 'Invite token already used');
    if (invite.expiresAt < new Date())
      throw new AcceptInviteError('EXPIRED', 'Invite token has expired');
    if (invite.email.toLowerCase() !== input.userEmail.toLowerCase()) {
      throw new AcceptInviteError('EMAIL_MISMATCH', 'This invite was issued to a different email');
    }

    await tx
      .update(schema.inviteTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.inviteTokens.id, invite.id));

    await tx
      .insert(schema.workspaceMembers)
      .values({ workspaceId: invite.workspaceId, userId: input.userId, role: invite.role })
      .onConflictDoNothing();

    return { workspaceId: invite.workspaceId, role: invite.role };
  });
}
