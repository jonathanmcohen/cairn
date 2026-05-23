import { and, eq } from 'drizzle-orm';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function patch(workspaceId: string, userId: string, body: unknown) {
  const { PATCH } = await import('@/app/api/workspaces/[id]/members/[userId]/route');
  const res = await PATCH(
    new Request(`http://localhost/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: workspaceId, userId }) },
  );
  return { status: res.status };
}
async function del(workspaceId: string, userId: string) {
  const { DELETE } = await import('@/app/api/workspaces/[id]/members/[userId]/route');
  const res = await DELETE(
    new Request(`http://localhost/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id: workspaceId, userId }) },
  );
  return { status: res.status };
}

describe('PATCH/DELETE /api/workspaces/[id]/members/[userId]', () => {
  it('admin changes a member role -> 200', async () => {
    const w = await ws();
    const owner = await user('owner');
    const ed = await user('editor');
    await add(w, owner, 'owner');
    await add(w, ed, 'editor');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: owner });
    const r = await patch(w, ed, { role: 'admin' });
    expect(r.status).toBe(200);
    const [m] = await getDb()
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(eq(schema.workspaceMembers.workspaceId, w), eq(schema.workspaceMembers.userId, ed)),
      );
    expect(m?.role).toBe('admin');
  });

  it('editor (below admin) is 403', async () => {
    const w = await ws();
    const owner = await user('owner');
    const ed = await user('editor');
    await add(w, owner, 'owner');
    await add(w, ed, 'editor');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: ed });
    const r = await patch(w, owner, { role: 'admin' });
    expect(r.status).toBe(403);
  });

  it('admin removes a member -> 200', async () => {
    const w = await ws();
    const owner = await user('owner');
    const ed = await user('editor');
    await add(w, owner, 'owner');
    await add(w, ed, 'editor');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: owner });
    const r = await del(w, ed);
    expect(r.status).toBe(200);
    const rows = await getDb()
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(eq(schema.workspaceMembers.workspaceId, w), eq(schema.workspaceMembers.userId, ed)),
      );
    expect(rows).toHaveLength(0);
  });

  it('removing an owner -> 409', async () => {
    const w = await ws();
    const owner = await user('owner');
    const admin = await user('admin');
    await add(w, owner, 'owner');
    await add(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const r = await del(w, owner);
    expect(r.status).toBe(409);
  });

  it('cross-workspace target -> 404', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const owner = await user('owner');
    const ed = await user('editor');
    await add(w1, owner, 'owner');
    await add(w2, ed, 'editor');
    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: owner });
    const r = await patch(w2, ed, { role: 'admin' });
    expect(r.status).toBe(404);
  });

  it('unauthenticated -> 401', async () => {
    const w = await ws();
    active = { name: 'cairn_ws', value: w };
    await setUser(null);
    const r = await patch(w, '00000000-0000-0000-0000-000000000000', { role: 'admin' });
    expect(r.status).toBe(401);
  });
});
