import { asc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser, type TestUser } from '../helpers/fixtures';

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

async function makePage(workspaceId: string, userId: string, title = 'P') {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title, createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

async function seedThreeFavorites(u: TestUser) {
  const a = await makePage(u.workspaceId, u.userId, 'A');
  const b = await makePage(u.workspaceId, u.userId, 'B');
  const c = await makePage(u.workspaceId, u.userId, 'C');
  const favs = await getDb()
    .insert(schema.userPagePrefs)
    .values(
      [a, b, c].map((p, i) => ({
        userId: u.userId,
        workspaceId: u.workspaceId,
        pageId: p.id,
        favorite: true,
        position: i,
      })),
    )
    .returning({ id: schema.userPagePrefs.id, pageId: schema.userPagePrefs.pageId });
  return { user: u, favs };
}

describe('POST /api/favorites/reorder', () => {
  it('401 unauthenticated', async () => {
    await setUser(null);
    cookieVal.ws = '';
    const route = await import('@/app/api/favorites/reorder/route');
    const res = await route.POST(
      new Request('http://t/api/favorites/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderedFavoriteIds: [] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("reorders the caller's favorites + returns ok", async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const { favs } = await seedThreeFavorites(u);

    const route = await import('@/app/api/favorites/reorder/route');
    const res = await route.POST(
      new Request('http://t/api/favorites/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderedFavoriteIds: [favs[2]!.id, favs[0]!.id, favs[1]!.id],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const rows = await getDb()
      .select()
      .from(schema.userPagePrefs)
      .where(eq(schema.userPagePrefs.userId, u.userId))
      .orderBy(asc(schema.userPagePrefs.position));
    expect(rows.map((r) => r.id)).toEqual([favs[2]!.id, favs[0]!.id, favs[1]!.id]);
  });

  it('400 on malformed body', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const route = await import('@/app/api/favorites/reorder/route');
    const res = await route.POST(
      new Request('http://t/api/favorites/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderedFavoriteIds: 'not-an-array' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('cross-user ids in the payload are silently skipped (200, those rows untouched)', async () => {
    const ua = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const ub = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const a = await seedThreeFavorites(ua);
    const b = await seedThreeFavorites(ub);

    cookieVal.ws = ua.workspaceId;
    await setUser({ userId: ua.userId });

    const route = await import('@/app/api/favorites/reorder/route');
    const res = await route.POST(
      new Request('http://t/api/favorites/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderedFavoriteIds: [a.favs[1]!.id, b.favs[0]!.id, a.favs[0]!.id, a.favs[2]!.id],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const bRows = await getDb()
      .select()
      .from(schema.userPagePrefs)
      .where(eq(schema.userPagePrefs.userId, ub.userId))
      .orderBy(asc(schema.userPagePrefs.position));
    expect(bRows.map((r) => r.position)).toEqual([0, 1, 2]); // untouched
  });
});

describe('POST /api/prefs/favorites/reorder (legacy shim)', () => {
  it('accepts the new orderedFavoriteIds shape', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const { favs } = await seedThreeFavorites(u);

    const route = await import('@/app/api/prefs/favorites/reorder/route');
    const res = await route.POST(
      new Request('http://t/api/prefs/favorites/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderedFavoriteIds: [favs[1]!.id, favs[0]!.id, favs[2]!.id] }),
      }),
    );
    expect(res.status).toBe(200);
    const rows = await getDb()
      .select()
      .from(schema.userPagePrefs)
      .where(eq(schema.userPagePrefs.userId, u.userId))
      .orderBy(asc(schema.userPagePrefs.position));
    expect(rows.map((r) => r.id)).toEqual([favs[1]!.id, favs[0]!.id, favs[2]!.id]);
  });

  it('accepts the legacy orderedPageIds shape', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const { favs } = await seedThreeFavorites(u);

    const route = await import('@/app/api/prefs/favorites/reorder/route');
    const res = await route.POST(
      new Request('http://t/api/prefs/favorites/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderedPageIds: [favs[2]!.pageId, favs[1]!.pageId, favs[0]!.pageId],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const rows = await getDb()
      .select()
      .from(schema.userPagePrefs)
      .where(eq(schema.userPagePrefs.userId, u.userId))
      .orderBy(asc(schema.userPagePrefs.position));
    expect(rows.map((r) => r.pageId)).toEqual([favs[2]!.pageId, favs[1]!.pageId, favs[0]!.pageId]);
  });
});
