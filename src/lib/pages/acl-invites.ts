import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError } from '@/lib/auth/require-role';

/** Page email-invites expire 14 days after creation. */
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type InvitePermission = 'view' | 'comment' | 'edit' | 'owner';

export type PageAclInviteListItem = {
  id: string;
  email: string;
  permission: InvitePermission;
  invitedBy: string;
  createdAt: Date;
  expiresAt: Date;
};

function isUniqueViolation(err: unknown): boolean {
  // Walk `.cause` because Drizzle's transaction wraps the driver error.
  let cursor: unknown = err;
  for (let i = 0; i < 6 && cursor; i++) {
    if (
      cursor &&
      typeof cursor === 'object' &&
      'code' in cursor &&
      (cursor as { code: string }).code === '23505'
    ) {
      return true;
    }
    cursor = (cursor as { cause?: unknown })?.cause;
  }
  return false;
}

export type CreatePageAclInviteInput = {
  workspaceId: string;
  pageId: string;
  email: string;
  permission: InvitePermission;
  invitedBy: string;
};

/**
 * Create a pending page-access invite for an email that may not yet be a
 * workspace member. The email is lower-cased on write (and the partial-unique
 * index keys on lower(email)), so a second pending invite for the same
 * (page,email) throws HttpError(409). Records `page.permission_invited` —
 * metadata carries email + permission only (never the token).
 */
export async function createPageAclInvite(
  db: PostgresJsDatabase<typeof schema>,
  input: CreatePageAclInviteInput,
): Promise<schema.PageAclInvite> {
  const email = input.email.trim().toLowerCase();
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.pageAclInvites)
        .values({
          pageId: input.pageId,
          workspaceId: input.workspaceId,
          email,
          permission: input.permission,
          token,
          invitedBy: input.invitedBy,
          expiresAt,
        })
        .returning();
      if (!row) throw new HttpError(500, 'invite insert failed');
      await recordAudit(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.invitedBy,
        action: 'page.permission_invited',
        targetType: 'page_acl_invite',
        targetId: row.id,
        metadata: { email, permission: input.permission },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'An invite for this email is already pending');
    }
    throw err;
  }
}

/**
 * List the live (un-accepted, non-expired) invites pinned on a page, newest
 * first. Excludes accepted + expired rows.
 */
export async function listPageAclInvites(
  db: PostgresJsDatabase<typeof schema>,
  pageId: string,
): Promise<PageAclInviteListItem[]> {
  const rows = await db
    .select({
      id: schema.pageAclInvites.id,
      email: schema.pageAclInvites.email,
      permission: schema.pageAclInvites.permission,
      invitedBy: schema.pageAclInvites.invitedBy,
      createdAt: schema.pageAclInvites.createdAt,
      expiresAt: schema.pageAclInvites.expiresAt,
    })
    .from(schema.pageAclInvites)
    .where(
      and(
        eq(schema.pageAclInvites.pageId, pageId),
        isNull(schema.pageAclInvites.acceptedAt),
        gt(schema.pageAclInvites.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.pageAclInvites.createdAt));

  return rows.flatMap((r) => {
    if (
      r.permission !== 'view' &&
      r.permission !== 'comment' &&
      r.permission !== 'edit' &&
      r.permission !== 'owner'
    ) {
      return [];
    }
    return [
      {
        id: r.id,
        email: r.email,
        permission: r.permission,
        invitedBy: r.invitedBy,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      },
    ];
  });
}

export type RevokePageAclInviteInput = {
  workspaceId: string;
  pageId: string;
  inviteId: string;
  actorUserId: string;
};

/**
 * Delete a pending invite + record `page.permission_invite_revoked`. Scoped to
 * (pageId, inviteId) so a caller cannot revoke another page's invite by id.
 * Idempotent: returns silently if no matching row exists.
 */
export async function revokePageAclInvite(
  db: PostgresJsDatabase<typeof schema>,
  input: RevokePageAclInviteInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.pageAclInvites)
      .where(
        and(
          eq(schema.pageAclInvites.id, input.inviteId),
          eq(schema.pageAclInvites.pageId, input.pageId),
        ),
      )
      .returning({ email: schema.pageAclInvites.email });
    if (deleted.length === 0) return;
    await recordAudit(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: 'page.permission_invite_revoked',
      targetType: 'page_acl_invite',
      targetId: input.inviteId,
      metadata: { email: deleted[0]?.email ?? null },
    });
  });
}

export type AcceptInvitesForNewMemberInput = {
  workspaceId: string;
  userId: string;
  email: string;
};

/**
 * Materialize any pending invites for a freshly-joined member. For each live
 * invite matching the user's email (case-insensitive) in this workspace: write
 * a page_acls grant at the invited permission, stamp accepted_at, and record
 * `page.permission_granted`. Safe to call repeatedly — accepted invites are
 * skipped on the next pass.
 */
export async function acceptInvitesForNewMember(
  db: PostgresJsDatabase<typeof schema>,
  input: AcceptInvitesForNewMemberInput,
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  await db.transaction(async (tx) => {
    const pending = await tx
      .select()
      .from(schema.pageAclInvites)
      .where(
        and(
          eq(schema.pageAclInvites.workspaceId, input.workspaceId),
          eq(rawSql`lower(${schema.pageAclInvites.email})`, email),
          isNull(schema.pageAclInvites.acceptedAt),
          gt(schema.pageAclInvites.expiresAt, new Date()),
        ),
      );

    for (const invite of pending) {
      await tx
        .insert(schema.pageAcls)
        .values({ pageId: invite.pageId, userId: input.userId, permission: invite.permission })
        .onConflictDoUpdate({
          target: [schema.pageAcls.pageId, schema.pageAcls.userId],
          set: { permission: invite.permission, updatedAt: new Date() },
        });
      await tx
        .update(schema.pageAclInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.pageAclInvites.id, invite.id));
      await recordAudit(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        action: 'page.permission_granted',
        targetType: 'page_acl',
        targetId: invite.pageId,
        metadata: { userId: input.userId, permission: invite.permission, viaInvite: invite.id },
      });
    }
  });
}
