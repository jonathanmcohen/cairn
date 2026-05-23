import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
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
async function addMember(workspaceId: string, userId: string, role: schema.MemberRole) {
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

type Json = { entries: (typeof schema.auditLog.$inferSelect)[]; nextCursor: string | null };
async function get(query = ''): Promise<{ status: number; json: Json }> {
  const { GET } = await import('@/app/api/admin/audit/route');
  const res = await GET(
    new Request(`http://localhost/api/admin/audit${query ? `?${query}` : ''}`, {
      method: 'GET',
    }) as never,
  );
  const status = res.status;
  const json = status >= 200 && status < 300 ? ((await res.json()) as Json) : ({} as Json);
  return { status, json };
}

describe('GET /api/admin/audit', () => {
  it('admin → 200 with entries scoped to the active workspace only', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const admin = await user('admin');
    const someone = await user('someone');
    await addMember(w1, admin, 'admin');
    await getDb().insert(schema.auditLog).values({
      workspaceId: w1,
      actorUserId: admin,
      action: 'page.published',
      targetType: 'page',
      targetId: '11111111-1111-1111-1111-111111111111',
    });
    await getDb().insert(schema.auditLog).values({
      workspaceId: w2,
      actorUserId: someone,
      action: 'page.published',
      targetType: 'page',
      targetId: '22222222-2222-2222-2222-222222222222',
    });

    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: admin });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.json.entries).toHaveLength(1);
    expect(r.json.entries[0]?.workspaceId).toBe(w1);
    expect(r.json.nextCursor).toBeNull();
  });

  it('editor → 403 (admin gate)', async () => {
    const w = await ws();
    const ed = await user('editor');
    await addMember(w, ed, 'editor');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: ed });
    const r = await get();
    expect(r.status).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    const w = await ws();
    active = { name: 'cairn_ws', value: w };
    await setUser(null);
    const r = await get();
    expect(r.status).toBe(401);
  });

  it('filters narrow by action + actorId', async () => {
    const w = await ws();
    const admin = await user('admin');
    const alice = await user('alice');
    const bob = await user('bob');
    await addMember(w, admin, 'admin');
    // Mix of actions and actors.
    await getDb()
      .insert(schema.auditLog)
      .values([
        {
          workspaceId: w,
          actorUserId: alice,
          action: 'page.published',
          targetType: 'page',
          targetId: '11111111-1111-1111-1111-111111111111',
        },
        {
          workspaceId: w,
          actorUserId: bob,
          action: 'page.published',
          targetType: 'page',
          targetId: '22222222-2222-2222-2222-222222222222',
        },
        {
          workspaceId: w,
          actorUserId: alice,
          action: 'page.unpublished',
          targetType: 'page',
          targetId: '11111111-1111-1111-1111-111111111111',
        },
      ]);

    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const r = await get(`action=page.published&actorId=${alice}`);
    expect(r.status).toBe(200);
    expect(r.json.entries).toHaveLength(1);
    expect(r.json.entries[0]?.action).toBe('page.published');
    expect(r.json.entries[0]?.actorUserId).toBe(alice);
  });

  it('pagination via limit + cursor returns the expected window', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    const now = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const [row] = await getDb()
        .insert(schema.auditLog)
        .values({
          workspaceId: w,
          actorUserId: admin,
          action: 'page.published',
          targetType: 'page',
          targetId: '11111111-1111-1111-1111-111111111111',
          createdAt: new Date(now - i * 1000),
        })
        .returning();
      if (!row) throw new Error('insert failed');
      ids.push(row.id);
    }

    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });

    const p1 = await get('limit=2');
    expect(p1.status).toBe(200);
    expect(p1.json.entries).toHaveLength(2);
    expect(p1.json.nextCursor).not.toBeNull();

    const p2 = await get(`limit=2&cursor=${encodeURIComponent(p1.json.nextCursor as string)}`);
    expect(p2.status).toBe(200);
    expect(p2.json.entries).toHaveLength(2);
    expect(p2.json.nextCursor).not.toBeNull();

    const p3 = await get(`limit=2&cursor=${encodeURIComponent(p2.json.nextCursor as string)}`);
    expect(p3.status).toBe(200);
    expect(p3.json.entries).toHaveLength(1);
    expect(p3.json.nextCursor).toBeNull();

    const collected = [...p1.json.entries, ...p2.json.entries, ...p3.json.entries].map((e) => e.id);
    expect(new Set(collected).size).toBe(5);
    expect(new Set(collected)).toEqual(new Set(ids));
  });

  it('response contains no raw api-key secrets (recordAudit guard + JSON contents)', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');

    // Simulate api-key creation flow: recordAudit MUST refuse a raw token.
    const rawToken = 'cairn_sk_abc123_super_secret_token_value_12345';
    await expect(
      getDb().transaction((tx) =>
        recordAudit(tx, {
          workspaceId: w,
          actorUserId: admin,
          action: 'api_key.created',
          targetType: 'api_key',
          targetId: '33333333-3333-3333-3333-333333333333',
          metadata: { rawToken },
        }),
      ),
    ).rejects.toThrow();

    // What actually gets recorded is metadata-only (no raw token).
    await getDb().transaction((tx) =>
      recordAudit(tx, {
        workspaceId: w,
        actorUserId: admin,
        action: 'api_key.created',
        targetType: 'api_key',
        targetId: '33333333-3333-3333-3333-333333333333',
        metadata: { name: 'CI bot' },
      }),
    );

    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.json.entries.length).toBeGreaterThan(0);
    const body = JSON.stringify(r.json);
    expect(body).not.toContain(rawToken);
    expect(body).not.toContain('cairn_sk_');
  });
});
