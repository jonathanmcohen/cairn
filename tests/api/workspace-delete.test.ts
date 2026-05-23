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
  await sql`TRUNCATE audit_log, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function del(workspaceId: string) {
  const { DELETE } = await import('@/app/api/workspaces/[id]/route');
  const res = await DELETE(
    new Request(`http://localhost/api/workspaces/${workspaceId}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: workspaceId }) },
  );
  return { status: res.status };
}

describe('DELETE /api/workspaces/[id]', () => {
  it('owner deletes -> 200, workspace gone', async () => {
    const w = await ws();
    const owner = await user('owner');
    await add(w, owner, 'owner');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: owner });
    const r = await del(w);
    expect(r.status).toBe(200);
    const rows = await getDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, w));
    expect(rows).toHaveLength(0);
  });

  it('admin (not owner) -> 403', async () => {
    const w = await ws();
    const owner = await user('owner');
    const adm = await user('admin');
    await add(w, owner, 'owner');
    await add(w, adm, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: adm });
    const r = await del(w);
    expect(r.status).toBe(403);
  });

  it('cross-workspace id -> 404', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const owner = await user('owner');
    await add(w1, owner, 'owner');
    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: owner });
    const r = await del(w2);
    expect(r.status).toBe(404);
    // w2 still exists.
    const rows = await getDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, w2));
    expect(rows).toHaveLength(1);
  });
});
