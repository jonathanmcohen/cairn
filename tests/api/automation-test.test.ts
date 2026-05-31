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

describe('automation test-rule (dry-run) route', () => {
  it('returns would_run with a generated sample payload', async () => {
    const wsId = await ws();
    const uId = await user('admin');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: wsId, userId: uId, role: 'admin' });
    await setUser({ userId: uId });
    active = { name: 'cairn_ws', value: wsId };

    const { POST: testRule } = await import('@/app/api/automation/test/route');
    const res = await testRule(
      new Request('http://t/api/automation/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          triggerEvent: 'row.created',
          condition: { property: 'row.cells.status', operator: 'equals', value: 'Done' },
          actionType: 'notify',
          actionConfig: { userId: uId },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { status: string; matched: boolean };
      payload: unknown;
    };
    expect(body.result.status).toBe('would_run');
    expect(body.result.matched).toBe(true);
    expect(body.payload).toBeTypeOf('object');
  });

  it('does not write any automation_runs rows (no side effects)', async () => {
    const wsId = await ws();
    const uId = await user('admin');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: wsId, userId: uId, role: 'admin' });
    await setUser({ userId: uId });
    active = { name: 'cairn_ws', value: wsId };
    const { POST: testRule } = await import('@/app/api/automation/test/route');
    await testRule(
      new Request('http://t/api/automation/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          triggerEvent: 'row.created',
          condition: {},
          actionType: 'notify',
          actionConfig: { userId: uId },
        }),
      }),
    );
    const runs = await getDb().select().from(schema.automationRuns);
    expect(runs).toHaveLength(0);
  });

  it('requires admin (viewer is rejected)', async () => {
    const wsId = await ws();
    const uId = await user('viewer');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: wsId, userId: uId, role: 'viewer' });
    await setUser({ userId: uId });
    active = { name: 'cairn_ws', value: wsId };
    const { POST: testRule } = await import('@/app/api/automation/test/route');
    const res = await testRule(
      new Request('http://t/api/automation/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          triggerEvent: 'row.created',
          condition: {},
          actionType: 'notify',
          actionConfig: { userId: uId },
        }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
