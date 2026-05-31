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
  await sql`TRUNCATE automation_runs, automation_rules, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

describe('automation rules CRUD', () => {
  it('admin POST creates a rule', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });

    const { POST } = await import('@/app/api/automation/rules/route');
    const res = await POST(
      new Request('http://x/api/automation/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'R1',
          triggerEvent: 'row.created',
          condition: {},
          actionType: 'notify',
          actionConfig: { userId: admin },
          enabled: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('R1');
    const rules = await getDb().select().from(schema.automationRules);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.workspaceId).toBe(w);
    expect(rules[0]?.createdBy).toBe(admin);
  });

  it('GET lists only the caller workspace', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const admin = await user('admin');
    await addMember(w1, admin, 'admin');

    const db = getDb();
    await db.insert(schema.automationRules).values([
      {
        workspaceId: w1,
        name: 'mine',
        triggerEvent: 'row.created',
        actionType: 'notify',
        actionConfig: { userId: admin },
      },
      {
        workspaceId: w2,
        name: 'theirs',
        triggerEvent: 'row.created',
        actionType: 'notify',
        actionConfig: { userId: admin },
      },
    ]);

    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: admin });

    const { GET } = await import('@/app/api/automation/rules/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].name).toBe('mine');
  });

  it('PATCH updates fields', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    const db = getDb();
    const [rule] = await db
      .insert(schema.automationRules)
      .values({
        workspaceId: w,
        name: 'old',
        triggerEvent: 'row.created',
        actionType: 'notify',
        actionConfig: { userId: admin },
      })
      .returning();
    if (!rule) throw new Error('rule insert failed');

    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });

    const { PATCH } = await import('@/app/api/automation/rules/[ruleId]/route');
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'new', enabled: false }),
      }),
      { params: Promise.resolve({ ruleId: rule.id }) },
    );
    expect(res.status).toBe(200);
    const fresh = await getDb().select().from(schema.automationRules);
    expect(fresh[0]?.name).toBe('new');
    expect(fresh[0]?.enabled).toBe(false);
  });

  it('DELETE removes the rule + cascades runs', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    const db = getDb();
    const [rule] = await db
      .insert(schema.automationRules)
      .values({
        workspaceId: w,
        name: 'r',
        triggerEvent: 'row.created',
        actionType: 'notify',
        actionConfig: { userId: admin },
      })
      .returning();
    if (!rule) throw new Error('rule insert failed');
    await db
      .insert(schema.automationRuns)
      .values({ ruleId: rule.id, triggerPayload: {}, status: 'success' });

    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });

    const { DELETE } = await import('@/app/api/automation/rules/[ruleId]/route');
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), {
      params: Promise.resolve({ ruleId: rule.id }),
    });
    expect(res.status).toBe(204);
    const fresh = await getDb().select().from(schema.automationRules);
    expect(fresh).toHaveLength(0);
    const runs = await getDb().select().from(schema.automationRuns);
    expect(runs).toHaveLength(0); // ON DELETE CASCADE
  });

  it('editor (non-admin) gets 403 on POST', async () => {
    const w = await ws();
    const editor = await user('editor');
    await addMember(w, editor, 'editor');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: editor });

    const { POST } = await import('@/app/api/automation/rules/route');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'n',
          triggerEvent: 'row.created',
          actionType: 'notify',
          actionConfig: {},
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('editor (non-admin) gets 403 on PATCH', async () => {
    const w = await ws();
    const admin = await user('admin');
    const editor = await user('editor');
    await addMember(w, admin, 'admin');
    await addMember(w, editor, 'editor');
    const db = getDb();
    const [rule] = await db
      .insert(schema.automationRules)
      .values({
        workspaceId: w,
        name: 'r',
        triggerEvent: 'row.created',
        actionType: 'notify',
        actionConfig: {},
      })
      .returning();
    if (!rule) throw new Error('rule insert failed');

    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: editor });

    const { PATCH } = await import('@/app/api/automation/rules/[ruleId]/route');
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      }),
      { params: Promise.resolve({ ruleId: rule.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('editor (non-admin) gets 403 on DELETE', async () => {
    const w = await ws();
    const admin = await user('admin');
    const editor = await user('editor');
    await addMember(w, admin, 'admin');
    await addMember(w, editor, 'editor');
    const db = getDb();
    const [rule] = await db
      .insert(schema.automationRules)
      .values({
        workspaceId: w,
        name: 'r',
        triggerEvent: 'row.created',
        actionType: 'notify',
        actionConfig: {},
      })
      .returning();
    if (!rule) throw new Error('rule insert failed');

    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: editor });

    const { DELETE } = await import('@/app/api/automation/rules/[ruleId]/route');
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), {
      params: Promise.resolve({ ruleId: rule.id }),
    });
    expect(res.status).toBe(403);
  });

  it('cross-workspace PATCH returns 404 (not 403, per cairn convention)', async () => {
    const w1 = await ws();
    const w2 = await ws();
    const admin = await user('admin');
    await addMember(w1, admin, 'admin');
    const db = getDb();
    const [rule] = await db
      .insert(schema.automationRules)
      .values({
        workspaceId: w2,
        name: 'theirs',
        triggerEvent: 'row.created',
        actionType: 'notify',
        actionConfig: {},
      })
      .returning();
    if (!rule) throw new Error('rule insert failed');

    active = { name: 'cairn_ws', value: w1 };
    await setUser({ userId: admin });

    const { PATCH } = await import('@/app/api/automation/rules/[ruleId]/route');
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      }),
      { params: Promise.resolve({ ruleId: rule.id }) },
    );
    expect(res.status).toBe(404);
    // Confirm the target rule is untouched.
    const [unchanged] = await getDb()
      .select()
      .from(schema.automationRules)
      .where(eq(schema.automationRules.id, rule.id));
    expect(unchanged?.name).toBe('theirs');
  });

  it('non-existent rule returns 404 on DELETE', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });

    const { DELETE } = await import('@/app/api/automation/rules/[ruleId]/route');
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), {
      params: Promise.resolve({ ruleId: '00000000-0000-0000-0000-000000000000' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST persists and returns the builder editor blob', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });

    const builder = {
      triggerEvent: 'row.created',
      conditions: { combinator: 'and', rows: [] },
      actions: [{ id: 'a1', type: 'notify', config: { userId: admin } }],
    };
    const { POST, GET } = await import('@/app/api/automation/rules/route');
    const res = await POST(
      new Request('http://x/api/automation/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Builder rule',
          triggerEvent: 'row.created',
          condition: {},
          actionType: 'notify',
          actionConfig: { userId: admin },
          builder,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; builder: typeof builder };
    expect(created.builder).toEqual(builder);

    const listRes = await GET();
    const { rules } = (await listRes.json()) as {
      rules: Array<{ id: string; builder: unknown }>;
    };
    expect(rules.find((r) => r.id === created.id)?.builder).toEqual(builder);
  });

  it('PATCH persists an updated builder blob', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    const [rule] = await getDb()
      .insert(schema.automationRules)
      .values({
        workspaceId: w,
        name: 'r',
        triggerEvent: 'row.created',
        actionType: 'notify',
        actionConfig: { userId: admin },
      })
      .returning();
    if (!rule) throw new Error('rule insert failed');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });

    const builder = {
      triggerEvent: 'row.updated',
      conditions: { combinator: 'or', rows: [] },
      actions: [{ id: 'a9', type: 'notify', config: { userId: admin } }],
    };
    const { PATCH } = await import('@/app/api/automation/rules/[ruleId]/route');
    const res = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ builder }),
      }),
      { params: Promise.resolve({ ruleId: rule.id }) },
    );
    expect(res.status).toBe(200);
    const patched = (await res.json()) as { builder: typeof builder };
    expect(patched.builder).toEqual(builder);
  });

  it('CRUD round-trip: create, list, patch, delete', async () => {
    const w = await ws();
    const admin = await user('admin');
    await addMember(w, admin, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: admin });

    // Create
    const { POST, GET } = await import('@/app/api/automation/rules/route');
    const createRes = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'RT',
          triggerEvent: 'page.created',
          actionType: 'notify',
          actionConfig: { userId: admin },
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    // List
    const listRes = await GET();
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.rules).toHaveLength(1);
    expect(listBody.rules[0].id).toBe(created.id);

    // Patch
    const { PATCH, DELETE } = await import('@/app/api/automation/rules/[ruleId]/route');
    const patchRes = await PATCH(
      new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
      { params: Promise.resolve({ ruleId: created.id }) },
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.enabled).toBe(false);

    // Delete
    const delRes = await DELETE(new Request('http://x', { method: 'DELETE' }), {
      params: Promise.resolve({ ruleId: created.id }),
    });
    expect(delRes.status).toBe(204);

    const final = await GET();
    const finalBody = await final.json();
    expect(finalBody.rules).toHaveLength(0);
  });
});
