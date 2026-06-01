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

describe('automation run-history route', () => {
  it('returns recent runs newest-first, scoped to the rule', async () => {
    const wsId = await ws();
    const uId = await user('admin');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: wsId, userId: uId, role: 'admin' });
    await setUser({ userId: uId });
    active = { name: 'cairn_ws', value: wsId };

    const [rule] = await getDb()
      .insert(schema.automationRules)
      .values({
        workspaceId: wsId,
        name: 'r',
        triggerEvent: 'row.created',
        condition: {},
        actionType: 'notify',
        actionConfig: { userId: uId },
        createdBy: uId,
      })
      .returning();
    if (!rule) throw new Error('rule');
    await getDb()
      .insert(schema.automationRuns)
      .values([
        { ruleId: rule.id, triggerPayload: { n: 1 }, status: 'condition_unmet' },
        { ruleId: rule.id, triggerPayload: { n: 2 }, status: 'success' },
        { ruleId: rule.id, triggerPayload: { n: 3 }, status: 'failed', error: 'boom' },
      ]);

    const { GET: listRuns } = await import('@/app/api/automation/rules/[ruleId]/runs/route');
    const res = await listRuns(new Request('http://t/'), {
      params: Promise.resolve({ ruleId: rule.id }),
    });
    expect(res.status).toBe(200);
    const { runs } = (await res.json()) as {
      runs: Array<{ status: string; error: string | null }>;
    };
    expect(runs).toHaveLength(3);
    expect(runs.some((r) => r.status === 'failed' && r.error === 'boom')).toBe(true);
  });

  it('returns 404 for a rule in another workspace', async () => {
    const wsId = await ws();
    const otherWs = await ws();
    const uId = await user('admin');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: wsId, userId: uId, role: 'admin' });
    await setUser({ userId: uId });
    active = { name: 'cairn_ws', value: wsId };
    const [rule] = await getDb()
      .insert(schema.automationRules)
      .values({
        workspaceId: otherWs,
        name: 'r',
        triggerEvent: 'row.created',
        condition: {},
        actionType: 'notify',
        actionConfig: { userId: uId },
      })
      .returning();
    if (!rule) throw new Error('rule');
    const { GET: listRuns } = await import('@/app/api/automation/rules/[ruleId]/runs/route');
    const res = await listRuns(new Request('http://t/'), {
      params: Promise.resolve({ ruleId: rule.id }),
    });
    expect(res.status).toBe(404);
  });
});
