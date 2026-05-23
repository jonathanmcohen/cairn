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
  await sql`TRUNCATE workspaces, users, workspace_members, invite_tokens RESTART IDENTITY CASCADE`;
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
async function invite(workspaceId: string, email = 'invitee@example.com') {
  const [row] = await getDb()
    .insert(schema.inviteTokens)
    .values({
      workspaceId,
      email,
      role: 'editor',
      token: `tok-${Math.random().toString(36).slice(2)}`,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    })
    .returning();
  if (!row) throw new Error('invite insert failed');
  return row;
}

async function get(workspaceId: string) {
  const { GET } = await import('@/app/api/workspaces/[id]/invites/route');
  const res = await GET(new Request(`http://localhost/api/workspaces/${workspaceId}/invites`), {
    params: Promise.resolve({ id: workspaceId }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
}
async function del(workspaceId: string, inviteId: string) {
  const { DELETE } = await import('@/app/api/workspaces/[id]/invites/[inviteId]/route');
  const res = await DELETE(
    new Request(`http://localhost/api/workspaces/${workspaceId}/invites/${inviteId}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id: workspaceId, inviteId }) },
  );
  return { status: res.status };
}

describe('GET/DELETE /api/workspaces/[id]/invites', () => {
  it('admin lists only pending invites -> 200', async () => {
    const w = await ws();
    const owner = await user('owner');
    await add(w, owner, 'owner');
    const pending = await invite(w, 'pending@x.com');
    const used = await invite(w, 'used@x.com');
    await getDb()
      .update(schema.inviteTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.inviteTokens.id, used.id));
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: owner });
    const r = await get(w);
    expect(r.status).toBe(200);
    const body = r.body as { invites: Array<{ id: string; email: string }> };
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]?.id).toBe(pending.id);
  });

  it('admin revokes an invite -> 200, second revoke -> 404', async () => {
    const w = await ws();
    const owner = await user('owner');
    await add(w, owner, 'owner');
    const inv = await invite(w);
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: owner });
    const r1 = await del(w, inv.id);
    expect(r1.status).toBe(200);
    const r2 = await del(w, inv.id);
    expect(r2.status).toBe(404);
  });

  it('editor (below admin) listing -> 403', async () => {
    const w = await ws();
    const ed = await user('editor');
    await add(w, ed, 'editor');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: ed });
    const r = await get(w);
    expect(r.status).toBe(403);
  });

  it('editor (below admin) revoking -> 403', async () => {
    const w = await ws();
    const owner = await user('owner');
    const ed = await user('editor');
    await add(w, owner, 'owner');
    await add(w, ed, 'editor');
    const inv = await invite(w);
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: ed });
    const r = await del(w, inv.id);
    expect(r.status).toBe(403);
  });

  it('cross-workspace listing -> 404', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const owner = await user('owner');
    await add(w1, owner, 'owner');
    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: owner });
    const r = await get(w2);
    expect(r.status).toBe(404);
  });

  it('cross-workspace revoke -> 404', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const owner = await user('owner');
    await add(w1, owner, 'owner');
    await add(w2, owner, 'owner');
    const inv = await invite(w2);
    // Active workspace is w1; URL workspaceId is w2 → 404 before touching the invite.
    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: owner });
    const r = await del(w2, inv.id);
    expect(r.status).toBe(404);
  });

  it('unauthenticated listing -> 401', async () => {
    const w = await ws();
    active = { name: 'cairn_ws', value: w };
    await setUser(null);
    const r = await get(w);
    expect(r.status).toBe(401);
  });
});
