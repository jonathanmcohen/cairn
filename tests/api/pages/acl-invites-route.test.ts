import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE page_acl_invites, page_acls, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

const cookieVal = { ws: '' };
vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'cairn_ws' && cookieVal.ws ? { name, value: cookieVal.ws } : undefined,
    set: () => {},
  }),
}));

async function setUser(c: { userId: string } | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(c);
}

async function makePage(workspaceId: string, userId: string) {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

describe('POST /api/pages/[pageId]/acl-invites', () => {
  it('403s for a viewer without edit access', async () => {
    const viewer = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    cookieVal.ws = viewer.workspaceId;
    await setUser({ userId: viewer.userId });
    const page = await makePage(viewer.workspaceId, viewer.userId);

    const { POST } = await import('@/app/api/pages/[pageId]/acl-invites/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/acl-invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@y.io', permission: 'view' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('403s when an editor (not page-owner) invites at the owner tier', async () => {
    const editor = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = editor.workspaceId;
    await setUser({ userId: editor.userId });
    const page = await makePage(editor.workspaceId, editor.userId);

    const { POST } = await import('@/app/api/pages/[pageId]/acl-invites/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/acl-invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@y.io', permission: 'owner' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('200s for an editor inviting at a non-owner tier + persists the row', async () => {
    const editor = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = editor.workspaceId;
    await setUser({ userId: editor.userId });
    const page = await makePage(editor.workspaceId, editor.userId);

    const { POST } = await import('@/app/api/pages/[pageId]/acl-invites/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/acl-invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'Invitee@y.io', permission: 'comment' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);

    const rows = await getDb()
      .select()
      .from(schema.pageAclInvites)
      .where(eq(schema.pageAclInvites.pageId, page.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe('invitee@y.io');
  });
});

describe('GET/DELETE /api/pages/[pageId]/acl-invites', () => {
  it('lists then revokes an invite', async () => {
    const editor = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = editor.workspaceId;
    await setUser({ userId: editor.userId });
    const page = await makePage(editor.workspaceId, editor.userId);
    const [invite] = await getDb()
      .insert(schema.pageAclInvites)
      .values({
        pageId: page.id,
        workspaceId: editor.workspaceId,
        email: 'pending@y.io',
        permission: 'view',
        token: 'tok-1',
        invitedBy: editor.userId,
        expiresAt: new Date(Date.now() + 1_000_000),
      })
      .returning();
    if (!invite) throw new Error('invite insert failed');

    const route = await import('@/app/api/pages/[pageId]/acl-invites/route');
    const getRes = await route.GET(
      new Request(`http://localhost/api/pages/${page.id}/acl-invites`),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { invites: { email: string }[] };
    expect(body.invites.map((i) => i.email)).toEqual(['pending@y.io']);

    const delRes = await route.DELETE(
      new Request(`http://localhost/api/pages/${page.id}/acl-invites`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inviteId: invite.id }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(delRes.status).toBe(200);
    const rows = await getDb()
      .select()
      .from(schema.pageAclInvites)
      .where(eq(schema.pageAclInvites.pageId, page.id));
    expect(rows).toHaveLength(0);
  });
});
