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
  await sql`TRUNCATE user_page_prefs, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

describe('POST/GET /api/prefs/favorites', () => {
  it('toggles a favorite and lists it', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const p = await makePage(u.workspaceId, u.userId);

    const { POST, GET } = await import('@/app/api/prefs/favorites/route');
    const post = await POST(
      new Request('http://localhost/api/prefs/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId: p.id }),
      }),
    );
    expect(post.status).toBe(200);
    expect((await post.json()).favorite).toBe(true);

    const get = await GET();
    expect(get.status).toBe(200);
    const list = (await get.json()).favorites as { pageId: string }[];
    expect(list.map((f) => f.pageId)).toEqual([p.id]);
  });

  it('rejects favoriting a page in another workspace with 404', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const foreign = await makePage(other.workspaceId, other.userId);

    const { POST } = await import('@/app/api/prefs/favorites/route');
    const res = await POST(
      new Request('http://localhost/api/prefs/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId: foreign.id }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('unauthenticated favorites GET is 401', async () => {
    await setUser(null);
    const { GET } = await import('@/app/api/prefs/favorites/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('recordVisit via POST /api/prefs/recents then GET lists it', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const p = await makePage(u.workspaceId, u.userId);
    const { POST, GET } = await import('@/app/api/prefs/recents/route');
    const post = await POST(
      new Request('http://localhost/api/prefs/recents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId: p.id }),
      }),
    );
    expect(post.status).toBe(200);
    const get = await GET();
    const list = (await get.json()).recents as { pageId: string }[];
    expect(list.map((r) => r.pageId)).toEqual([p.id]);
  });

  it('POST /api/prefs/favorites/reorder reorders favorites', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const a = await makePage(u.workspaceId, u.userId);
    const b = await makePage(u.workspaceId, u.userId);

    const fav = await import('@/app/api/prefs/favorites/route');
    for (const p of [a, b]) {
      await fav.POST(
        new Request('http://localhost/api/prefs/favorites', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pageId: p.id }),
        }),
      );
    }

    const { POST: ReorderPOST } = await import('@/app/api/prefs/favorites/reorder/route');
    const res = await ReorderPOST(
      new Request('http://localhost/api/prefs/favorites/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderedPageIds: [b.id, a.id] }),
      }),
    );
    expect(res.status).toBe(200);

    const list = (await (await fav.GET()).json()).favorites as { pageId: string }[];
    expect(list.map((f) => f.pageId)).toEqual([b.id, a.id]);
  });
});
