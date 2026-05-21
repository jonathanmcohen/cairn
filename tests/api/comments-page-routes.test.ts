import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
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

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(method: 'GET' | 'POST', pageId: string, body?: unknown) {
  const mod = await import('@/app/api/pages/[pageId]/comments/route');
  const handler = mod[method] as (
    req: Request,
    ctx: { params: Promise<{ pageId: string }> },
  ) => Promise<Response>;
  const res = await handler(
    new Request(`http://localhost/api/pages/${pageId}/comments`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ pageId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('/api/pages/[pageId]/comments', () => {
  it('POST creates a comment as editor', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('POST', p.id, { body: 'hello', anchor: { blockId: 'b1' } });
    expect(r.status).toBe(201);
    expect((r.body as { body: string }).body).toBe('hello');
  });

  it('POST 403 for viewer', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('POST', p.id, { body: 'no' });
    expect(r.status).toBe(403);
  });

  it('POST 400 on malformed anchor', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('POST', p.id, { body: 'x', anchor: { blockId: 'b', from: 1 } });
    expect(r.status).toBe(400);
  });

  it('GET lists comments for viewer+', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call('GET', p.id);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it('GET 404 for a page in another workspace', async () => {
    await asUser('viewer');
    const other = await createTestWorkspaceWithUser(getDb());
    const p = await createPage(getDb(), {
      workspaceId: other.workspaceId,
      createdBy: other.userId,
    });
    const r = await call('GET', p.id);
    expect(r.status).toBe(404);
  });
});
