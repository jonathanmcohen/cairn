import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCache } from '@/app/openapi.json/route';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';

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
  __resetCache();
});

let active: { name: string; value: string } | undefined;
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
  cookies: async () => ({ get: () => active, set: () => {} }),
}));

async function setUser(c: { userId: string } | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(c);
}
async function user(name: string) {
  const [u] = await getDb()
    .insert(schema.users)
    .values({
      email: `${name}-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name,
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  return u.id;
}
async function ws() {
  const [w] = await getDb()
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2)}` })
    .returning();
  if (!w) throw new Error('workspace insert failed');
  return w.id;
}
async function addMember(workspaceId: string, userId: string, role: schema.MemberRole) {
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

describe('GET /openapi.json', () => {
  it('401 when not authenticated', async () => {
    const { GET } = await import('@/app/openapi.json/route');
    await setUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('403 when authenticated but with no workspace', async () => {
    const { GET } = await import('@/app/openapi.json/route');
    const uid = await user('lonely');
    await setUser({ userId: uid });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('200 + JSON for a workspace member with cache headers', async () => {
    const { GET } = await import('@/app/openapi.json/route');
    const w = await ws();
    const uid = await user('member');
    await addMember(w, uid, 'editor');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: uid });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/json/);
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toMatch(/max-age=3600/);
    const body = (await res.json()) as { openapi: string; info: { title: string } };
    expect(body.openapi).toMatch(/^3\.1/);
    expect(body.info.title).toBe('Cairn API');
  });

  it('caches the spec across calls (same JSON body)', async () => {
    const { GET } = await import('@/app/openapi.json/route');
    const w = await ws();
    const uid = await user('cached');
    await addMember(w, uid, 'viewer');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: uid });

    const a = await GET();
    const b = await GET();
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const aBody = await a.text();
    const bBody = await b.text();
    expect(aBody).toBe(bBody);
  });
});
