import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(method: 'GET' | 'PATCH' | 'DELETE', pageId: string, body?: unknown) {
  const mod = await import('@/app/api/pages/[pageId]/route');
  const handler = mod[method] as (
    req: Request,
    ctx: { params: Promise<{ pageId: string }> },
  ) => Promise<Response>;
  const res = await handler(
    new Request(`http://localhost/api/pages/${pageId}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ pageId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('/api/pages/[pageId]', () => {
  it('GET returns the page for viewer+', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'X',
    });
    const r = await call('GET', p.id);
    expect(r.status).toBe(200);
    expect((r.body as { title: string }).title).toBe('X');
  });

  it('GET 404 for page in another workspace', async () => {
    await asUser('viewer');
    const other = await createTestWorkspaceWithUser(getDb());
    const p = await createPage(getDb(), {
      workspaceId: other.workspaceId,
      createdBy: other.userId,
    });
    const r = await call('GET', p.id);
    expect(r.status).toBe(404);
  });

  it('PATCH updates content as editor', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('PATCH', p.id, {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
      },
    });
    expect(r.status).toBe(200);
    expect((r.body as { contentText: string }).contentText).toContain('Hi');
  });

  it('PATCH 403 for viewer', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('PATCH', p.id, { title: 'Try' });
    expect(r.status).toBe(403);
  });

  it('PATCH 409 on stale write', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await call('PATCH', p.id, { title: 'First' });
    const r = await call('PATCH', p.id, {
      title: 'Stale',
      expectedUpdatedAt: p.updatedAt.toISOString(),
    });
    expect(r.status).toBe(409);
  });

  it('DELETE soft-deletes the page', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('DELETE', p.id);
    expect(r.status).toBe(204);
    const r2 = await call('GET', p.id);
    expect(r2.status).toBe(404);
  });

  it('DELETE 403 for viewer', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('DELETE', p.id);
    expect(r.status).toBe(403);
  });
});
