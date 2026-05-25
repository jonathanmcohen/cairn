import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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

describe('PATCH /api/pages/[pageId]/cover', () => {
  it('200s + persists a valid cover', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const page = await makePage(u.workspaceId, u.userId);

    const { PATCH } = await import('@/app/api/pages/[pageId]/cover/route');
    const res = await PATCH(
      new Request(`http://localhost/api/pages/${page.id}/cover`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'color', value: '#abcdef' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);

    const [row] = await getDb()
      .select({ cover: schema.pages.cover })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(row?.cover).toEqual({ kind: 'color', value: '#abcdef' });
  });

  it('400s on an invalid cover payload', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const page = await makePage(u.workspaceId, u.userId);

    const { PATCH } = await import('@/app/api/pages/[pageId]/cover/route');
    const res = await PATCH(
      new Request(`http://localhost/api/pages/${page.id}/cover`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'gradient', value: 'nope' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('404s when the page belongs to a different workspace (no existence leak)', async () => {
    const a = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const b = await createTestWorkspaceWithUser(getDb(), {
      role: 'editor',
      email: 'other@example.com',
    });
    // Caller is signed in as user A but their active workspace is A. Page lives in B.
    cookieVal.ws = a.workspaceId;
    await setUser({ userId: a.userId });
    const page = await makePage(b.workspaceId, b.userId);

    const { PATCH } = await import('@/app/api/pages/[pageId]/cover/route');
    const res = await PATCH(
      new Request(`http://localhost/api/pages/${page.id}/cover`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'color', value: '#abcdef' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(404);
  });

  it('401s when unauthenticated', async () => {
    await setUser(null);
    cookieVal.ws = '';

    const { PATCH } = await import('@/app/api/pages/[pageId]/cover/route');
    const res = await PATCH(
      new Request('http://localhost/api/pages/00000000-0000-0000-0000-000000000000/cover', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'color', value: '#abcdef' }),
      }),
      { params: Promise.resolve({ pageId: '00000000-0000-0000-0000-000000000000' }) },
    );
    expect(res.status).toBe(401);
  });
});
