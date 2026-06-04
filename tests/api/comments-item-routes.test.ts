import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createComment } from '@/lib/comments/create';
import { createPage } from '@/lib/pages/create';
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
  await sql`TRUNCATE comments, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setActor(userId: string) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

async function call(method: 'PATCH' | 'DELETE', commentId: string, body?: unknown) {
  const mod = await import('@/app/api/comments/[commentId]/route');
  const handler = mod[method] as (
    req: Request,
    ctx: { params: Promise<{ commentId: string }> },
  ) => Promise<Response>;
  const res = await handler(
    new Request(`http://localhost/api/comments/${commentId}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ commentId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Add a second member to a workspace with a given role.
async function addMember(workspaceId: string, email: string, role: schema.MemberRole) {
  const [user] = await getDb()
    .insert(schema.users)
    .values({ email, passwordHash: 'h', name: email })
    .returning();
  if (!user) throw new Error('user insert failed');
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId: user.id, role });
  return user.id;
}

describe('/api/comments/[commentId]', () => {
  it('PATCH resolves then reopens as editor', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const { comment: c } = await createComment(getDb(), {
      workspaceId: u.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: u.userId,
      body: 'x',
    });
    await setActor(u.userId);

    const resolved = await call('PATCH', c.id, { resolved: true });
    expect(resolved.status).toBe(200);
    expect((resolved.body as { resolvedAt: string | null }).resolvedAt).not.toBeNull();

    const reopened = await call('PATCH', c.id, { resolved: false });
    expect((reopened.body as { resolvedAt: string | null }).resolvedAt).toBeNull();
  });

  it('PATCH 403 for viewer', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const { comment: c } = await createComment(getDb(), {
      workspaceId: u.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: u.userId,
      body: 'x',
    });
    const viewerId = await addMember(u.workspaceId, 'v@x.com', 'viewer');
    await setActor(viewerId);
    const r = await call('PATCH', c.id, { resolved: true });
    expect(r.status).toBe(403);
  });

  it('DELETE lets the author delete their own comment', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const { comment: c } = await createComment(getDb(), {
      workspaceId: u.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: u.userId,
      body: 'x',
    });
    await setActor(u.userId);
    const r = await call('DELETE', c.id);
    expect(r.status).toBe(204);
  });

  it('DELETE 403 for a non-author editor', async () => {
    const author = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const p = await createPage(getDb(), {
      workspaceId: author.workspaceId,
      createdBy: author.userId,
    });
    const { comment: c } = await createComment(getDb(), {
      workspaceId: author.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: author.userId,
      body: 'x',
    });
    const otherEditor = await addMember(author.workspaceId, 'e2@x.com', 'editor');
    await setActor(otherEditor);
    const r = await call('DELETE', c.id);
    expect(r.status).toBe(403);
  });

  it('DELETE lets an admin delete another member’s comment', async () => {
    const author = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const p = await createPage(getDb(), {
      workspaceId: author.workspaceId,
      createdBy: author.userId,
    });
    const { comment: c } = await createComment(getDb(), {
      workspaceId: author.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: author.userId,
      body: 'x',
    });
    const adminId = await addMember(author.workspaceId, 'a@x.com', 'admin');
    await setActor(adminId);
    const r = await call('DELETE', c.id);
    expect(r.status).toBe(204);
  });

  describe('PATCH body edit', () => {
    it('lets the author edit their comment body', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
      const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
      const { comment: c } = await createComment(getDb(), {
        workspaceId: u.workspaceId,
        target: { type: 'page', id: p.id },
        authorId: u.userId,
        body: 'taht',
      });
      await setActor(u.userId);
      const r = await call('PATCH', c.id, { body: 'fixed' });
      expect(r.status).toBe(200);
      expect((r.body as { body: string }).body).toBe('fixed');
    });

    it('PATCH body 403 for a non-author editor', async () => {
      const author = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
      const p = await createPage(getDb(), {
        workspaceId: author.workspaceId,
        createdBy: author.userId,
      });
      const { comment: c } = await createComment(getDb(), {
        workspaceId: author.workspaceId,
        target: { type: 'page', id: p.id },
        authorId: author.userId,
        body: 'x',
      });
      const otherEditor = await addMember(author.workspaceId, 'e3@x.com', 'editor');
      await setActor(otherEditor);
      const r = await call('PATCH', c.id, { body: 'hijack' });
      expect(r.status).toBe(403);
    });

    it('PATCH body 400 for an empty body', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
      const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
      const { comment: c } = await createComment(getDb(), {
        workspaceId: u.workspaceId,
        target: { type: 'page', id: p.id },
        authorId: u.userId,
        body: 'x',
      });
      await setActor(u.userId);
      const r = await call('PATCH', c.id, { body: '' });
      expect(r.status).toBe(400);
    });

    it('PATCH resolved still works (regression)', async () => {
      const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
      const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
      const { comment: c } = await createComment(getDb(), {
        workspaceId: u.workspaceId,
        target: { type: 'page', id: p.id },
        authorId: u.userId,
        body: 'x',
      });
      await setActor(u.userId);
      const r = await call('PATCH', c.id, { resolved: true });
      expect(r.status).toBe(200);
      expect((r.body as { resolvedAt: string | null }).resolvedAt).not.toBeNull();
    });
  });

  it('DELETE 404 for a comment in another workspace', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const other = await createTestWorkspaceWithUser(getDb());
    const p = await createPage(getDb(), {
      workspaceId: other.workspaceId,
      createdBy: other.userId,
    });
    const { comment: c } = await createComment(getDb(), {
      workspaceId: other.workspaceId,
      target: { type: 'page', id: p.id },
      authorId: other.userId,
      body: 'x',
    });
    await setActor(u.userId);
    const r = await call('DELETE', c.id);
    expect(r.status).toBe(404);
  });
});
