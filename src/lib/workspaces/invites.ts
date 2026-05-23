import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

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

export type CreateInviteInput = {
  workspaceId: string;
  actorUserId: string;
  email: string;
  role: schema.MemberRole;
  /** Defaults to 7 days. Clamped to a non-negative integer by the route layer. */
  expiresInDays?: number;
};

export type CreatedInvite = {
  invite: typeof schema.inviteTokens.$inferSelect;
  /** Raw token — returned ONCE here and never re-rendered after; never persisted in the audit log. */
  token: string;
};

/**
 * Mint a new invite token for a workspace + email. The insert + the
 * `invite.created` audit row are written in a single transaction so the
 * audit can never drift from the action (spec §2.27).
 *
 * Audit metadata records only `{email, role}` — the raw `token` is
 * deliberately NEVER recorded.
 */
export async function createInvite(db: Db, input: CreateInviteInput): Promise<CreatedInvite> {
  const expiresInDays = input.expiresInDays ?? 7;
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
  const email = input.email.toLowerCase();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.inviteTokens)
      .values({
        workspaceId: input.workspaceId,
        email,
        role: input.role,
        token,
        expiresAt,
      })
      .returning();
    if (!row) throw new Error('Failed to create invite token');
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'invite.created',
      targetType: 'invite',
      targetId: row.id,
      metadata: { email, role: input.role },
    });
    return { invite: row, token };
  });
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
 *
 * The update + the `invite.revoked` audit row are written in a single
 * transaction so the audit can never drift from the action (spec §2.27).
 * Audit metadata records `{email, role}` only — never the raw token.
 *
 * `actorUserId` is required when called from an audited admin flow; passing
 * `null` records the audit row with a null actor (e.g. system-initiated
 * revokes).
 */
export async function revokeInvite(
  db: Db,
  input: { workspaceId: string; inviteId: string; actorUserId: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.inviteTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(schema.inviteTokens.id, input.inviteId),
          eq(schema.inviteTokens.workspaceId, input.workspaceId),
          isNull(schema.inviteTokens.usedAt),
        ),
      )
      .returning({
        id: schema.inviteTokens.id,
        email: schema.inviteTokens.email,
        role: schema.inviteTokens.role,
      });
    if (updated.length === 0) {
      throw new RevokeInviteError('NOT_FOUND', 'Invite not found or already consumed');
    }
    const [row] = updated;
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'invite.revoked',
      targetType: 'invite',
      targetId: row?.id ?? input.inviteId,
      metadata: { email: row?.email ?? null, role: row?.role ?? null },
    });
  });
}
