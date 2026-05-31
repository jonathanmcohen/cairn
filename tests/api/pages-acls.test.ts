import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { listPageAcls } from '@/lib/pages/acl-list';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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
  await sql`TRUNCATE page_acls, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function addMember(workspaceId: string, userId: string, role: schema.MemberRole) {
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

describe('listPageAcls', () => {
  it('returns grants joined to user name/email', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const page = await makePage(owner.workspaceId, owner.userId);
    await getDb()
      .insert(schema.pageAcls)
      .values({ pageId: page.id, userId: owner.userId, permission: 'edit' });

    const rows = await listPageAcls(getDb(), page.id);
    expect(rows).toEqual([
      expect.objectContaining({
        userId: owner.userId,
        permission: 'edit',
        email: expect.any(String),
      }),
    ]);
  });
});

describe('PUT /api/pages/[pageId]/acls', () => {
  it('lets an editor grant a fellow member access', async () => {
    const editor = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const member = await createTestWorkspaceWithUser(getDb(), {
      role: 'viewer',
      email: 'm@example.com',
    });
    await addMember(editor.workspaceId, member.userId, 'viewer');
    cookieVal.ws = editor.workspaceId;
    await setUser({ userId: editor.userId });
    const page = await makePage(editor.workspaceId, editor.userId);

    const { PUT } = await import('@/app/api/pages/[pageId]/acls/route');
    const res = await PUT(
      new Request(`http://localhost/api/pages/${page.id}/acls`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: member.userId, permission: 'comment' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);

    const [row] = await getDb()
      .select({ permission: schema.pageAcls.permission })
      .from(schema.pageAcls)
      .where(eq(schema.pageAcls.pageId, page.id));
    expect(row?.permission).toBe('comment');
  });

  it('400s when the target user is not a workspace member', async () => {
    const editor = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const outsider = await createTestWorkspaceWithUser(getDb(), {
      role: 'editor',
      email: 'out@example.com',
    });
    cookieVal.ws = editor.workspaceId;
    await setUser({ userId: editor.userId });
    const page = await makePage(editor.workspaceId, editor.userId);

    const { PUT } = await import('@/app/api/pages/[pageId]/acls/route');
    const res = await PUT(
      new Request(`http://localhost/api/pages/${page.id}/acls`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: outsider.userId, permission: 'view' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('403s for a viewer without edit access', async () => {
    const viewer = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    cookieVal.ws = viewer.workspaceId;
    await setUser({ userId: viewer.userId });
    const page = await makePage(viewer.workspaceId, viewer.userId);

    const { PUT } = await import('@/app/api/pages/[pageId]/acls/route');
    const res = await PUT(
      new Request(`http://localhost/api/pages/${page.id}/acls`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: viewer.userId, permission: 'edit' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
  });
});

describe('GET /api/pages/[pageId]/acls', () => {
  it('lists grants for an editor', async () => {
    const editor = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = editor.workspaceId;
    await setUser({ userId: editor.userId });
    const page = await makePage(editor.workspaceId, editor.userId);
    await getDb()
      .insert(schema.pageAcls)
      .values({ pageId: page.id, userId: editor.userId, permission: 'edit' });

    const { GET } = await import('@/app/api/pages/[pageId]/acls/route');
    const res = await GET(new Request(`http://localhost/api/pages/${page.id}/acls`), {
      params: Promise.resolve({ pageId: page.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { acls: { userId: string }[] };
    expect(body.acls).toHaveLength(1);
  });
});

describe('DELETE /api/pages/[pageId]/acls', () => {
  it('removes a grant', async () => {
    const editor = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const member = await createTestWorkspaceWithUser(getDb(), {
      role: 'viewer',
      email: 'm2@example.com',
    });
    await addMember(editor.workspaceId, member.userId, 'viewer');
    cookieVal.ws = editor.workspaceId;
    await setUser({ userId: editor.userId });
    const page = await makePage(editor.workspaceId, editor.userId);
    await getDb()
      .insert(schema.pageAcls)
      .values({ pageId: page.id, userId: member.userId, permission: 'view' });

    const { DELETE } = await import('@/app/api/pages/[pageId]/acls/route');
    const res = await DELETE(
      new Request(`http://localhost/api/pages/${page.id}/acls`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: member.userId }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);
    const rows = await getDb()
      .select()
      .from(schema.pageAcls)
      .where(eq(schema.pageAcls.pageId, page.id));
    expect(rows).toHaveLength(0);
  });

  it('401s when unauthenticated', async () => {
    await setUser(null);
    cookieVal.ws = '';
    const { GET } = await import('@/app/api/pages/[pageId]/acls/route');
    const res = await GET(
      new Request('http://localhost/api/pages/00000000-0000-0000-0000-000000000000/acls'),
      { params: Promise.resolve({ pageId: '00000000-0000-0000-0000-000000000000' }) },
    );
    expect(res.status).toBe(401);
  });
});
