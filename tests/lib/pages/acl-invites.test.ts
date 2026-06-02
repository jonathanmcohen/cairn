import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';
import {
  acceptInvitesForNewMember,
  createPageAclInvite,
  listPageAclInvites,
  revokePageAclInvite,
} from '@/lib/pages/acl-invites';
import { listPageAcls } from '@/lib/pages/acl-list';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE page_acl_invites, page_acls, audit_log, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function addMember(
  workspaceId: string,
  email: string,
  role: schema.MemberRole,
): Promise<string> {
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: email })
    .returning();
  if (!u) throw new Error('user insert failed');
  await db.insert(schema.workspaceMembers).values({ workspaceId, userId: u.id, role });
  return u.id;
}

async function makePage(workspaceId: string, ownerId: string): Promise<string> {
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId, createdBy: ownerId, title: 'p', content: {} })
    .returning();
  if (!page) throw new Error('page insert failed');
  return page.id;
}

describe('createPageAclInvite', () => {
  it('inserts a pending invite with a token, 14-day expiry, and page.permission_invited audit', async () => {
    const ws = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const pageId = await makePage(ws.workspaceId, ws.userId);

    const before = Date.now();
    const row = await createPageAclInvite(db, {
      workspaceId: ws.workspaceId,
      pageId,
      email: 'NEW@x.io',
      permission: 'comment',
      invitedBy: ws.userId,
    });

    expect(row.email).toBe('new@x.io');
    expect(row.permission).toBe('comment');
    expect(row.token).toMatch(/^[0-9a-f-]{36}$/);
    const ttl = row.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(13 * 24 * 60 * 60 * 1000);
    expect(ttl).toBeLessThan(15 * 24 * 60 * 60 * 1000);

    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetType, 'page_acl_invite'))
      .limit(1);
    expect(audit?.action).toBe('page.permission_invited');
  });

  it('throws HttpError(409) on a second pending invite for the same (page,email)', async () => {
    const ws = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const pageId = await makePage(ws.workspaceId, ws.userId);
    await createPageAclInvite(db, {
      workspaceId: ws.workspaceId,
      pageId,
      email: 'dup@x.io',
      permission: 'view',
      invitedBy: ws.userId,
    });
    let caught: unknown = null;
    try {
      await createPageAclInvite(db, {
        workspaceId: ws.workspaceId,
        pageId,
        email: 'DUP@x.io',
        permission: 'edit',
        invitedBy: ws.userId,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(409);
  });
});

describe('listPageAclInvites', () => {
  it('returns only un-accepted, non-expired invites', async () => {
    const ws = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const pageId = await makePage(ws.workspaceId, ws.userId);
    await createPageAclInvite(db, {
      workspaceId: ws.workspaceId,
      pageId,
      email: 'live@x.io',
      permission: 'view',
      invitedBy: ws.userId,
    });
    // An expired invite must be filtered out.
    await db.insert(schema.pageAclInvites).values({
      pageId,
      workspaceId: ws.workspaceId,
      email: 'old@x.io',
      permission: 'view',
      token: 'tok-expired',
      invitedBy: ws.userId,
      expiresAt: new Date(Date.now() - 1000),
    });

    const pending = await listPageAclInvites(db, pageId);
    expect(pending.map((p) => p.email)).toEqual(['live@x.io']);
  });
});

describe('acceptInvitesForNewMember', () => {
  it('materializes a pending invite when the invitee joins', async () => {
    const ws = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const pageId = await makePage(ws.workspaceId, ws.userId);
    await createPageAclInvite(db, {
      workspaceId: ws.workspaceId,
      pageId,
      email: 'NEW@x.io',
      permission: 'comment',
      invitedBy: ws.userId,
    });
    const newUserId = await addMember(ws.workspaceId, 'new@x.io', 'editor');

    await acceptInvitesForNewMember(db, {
      workspaceId: ws.workspaceId,
      userId: newUserId,
      email: 'new@x.io',
    });

    const acls = await listPageAcls(db, pageId);
    expect(acls.find((a) => a.userId === newUserId)?.permission).toBe('comment');
    const pending = await listPageAclInvites(db, pageId);
    expect(pending).toHaveLength(0);

    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'page.permission_granted'));
    expect(audits.length).toBe(1);
  });
});

describe('revokePageAclInvite', () => {
  it('deletes the invite + records page.permission_invite_revoked', async () => {
    const ws = await createTestWorkspaceWithUser(db, { role: 'owner' });
    const pageId = await makePage(ws.workspaceId, ws.userId);
    const invite = await createPageAclInvite(db, {
      workspaceId: ws.workspaceId,
      pageId,
      email: 'gone@x.io',
      permission: 'view',
      invitedBy: ws.userId,
    });

    await revokePageAclInvite(db, {
      workspaceId: ws.workspaceId,
      pageId,
      inviteId: invite.id,
      actorUserId: ws.userId,
    });

    const pending = await listPageAclInvites(db, pageId);
    expect(pending).toHaveLength(0);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'page.permission_invite_revoked'));
    expect(audits.length).toBe(1);
  });
});
