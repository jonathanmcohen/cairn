import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  await sql`TRUNCATE audit_log, files, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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
async function add(workspaceId: string, userId: string, role: schema.MemberRole) {
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}
async function logoFile(workspaceId: string, uploadedBy: string) {
  const [f] = await getDb()
    .insert(schema.files)
    .values({
      workspaceId,
      name: 'logo.png',
      mimeType: 'image/png',
      size: 67,
      path: `${workspaceId}/logo.png`,
      uploadedBy,
    })
    .returning();
  if (!f) throw new Error('file insert failed');
  return f.id;
}

async function get(workspaceId: string) {
  const { GET } = await import('@/app/api/workspaces/[id]/brand/route');
  const res = await GET(new Request(`http://localhost/api/workspaces/${workspaceId}/brand`), {
    params: Promise.resolve({ id: workspaceId }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function patch(workspaceId: string, body: unknown) {
  const { PATCH } = await import('@/app/api/workspaces/[id]/brand/route');
  const res = await PATCH(
    new Request(`http://localhost/api/workspaces/${workspaceId}/brand`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: workspaceId }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('/api/workspaces/[id]/brand', () => {
  it('member (viewer) GET -> 200 with brand payload', async () => {
    const w = await ws();
    const viewer = await user('viewer');
    await add(w, viewer, 'viewer');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: viewer });
    const r = await get(w);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      logoFileId: null,
      logoUrl: null,
      primaryColor: null,
      appliedPrimary: null,
    });
  });

  it('editor PATCH -> 403 (admin-only write)', async () => {
    const w = await ws();
    const ed = await user('editor');
    await add(w, ed, 'editor');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: ed });
    const r = await patch(w, { primaryColor: '#2563eb' });
    expect(r.status).toBe(403);
  });

  it('admin PATCH -> 200, persisted + signed logo URL returned', async () => {
    const w = await ws();
    const admin = await user('admin');
    await add(w, admin, 'admin');
    const logo = await logoFile(w, admin);
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });

    const r = await patch(w, { logoFileId: logo, primaryColor: '#2563eb' });
    expect(r.status).toBe(200);
    expect(r.body.logoFileId).toBe(logo);
    expect(r.body.primaryColor).toBe('#2563eb');
    expect(String(r.body.logoUrl)).toMatch(new RegExp(`^/api/files/${logo}\\?sig=`));

    const [row] = await getDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, w));
    expect(row?.brandLogoFileId).toBe(logo);
    expect(row?.brandPrimaryColor).toBe('#2563eb');
  });

  it('admin PATCH with a foreign-workspace logo file -> 400 tenant guard', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const admin = await user('admin');
    await add(w1, admin, 'admin');
    const foreign = await logoFile(w2, admin);
    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: admin });

    const r = await patch(w1, { logoFileId: foreign });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('LOGO_NOT_IN_WORKSPACE');
  });

  it('cross-workspace URL id -> 404 (no existence leak)', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const owner = await user('owner');
    await add(w1, owner, 'owner');
    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: owner });
    expect((await get(w2)).status).toBe(404);
    expect((await patch(w2, { primaryColor: '#2563eb' })).status).toBe(404);
  });

  it('invalid color -> 400 INVALID_COLOR', async () => {
    const w = await ws();
    const admin = await user('admin');
    await add(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const r = await patch(w, { primaryColor: '#12345' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_COLOR');
  });

  it('anonymous GET -> 401/403', async () => {
    const w = await ws();
    active = undefined;
    await setUser(null);
    const r = await get(w);
    expect([401, 403]).toContain(r.status);
  });
});
