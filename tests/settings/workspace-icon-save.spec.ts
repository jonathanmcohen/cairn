/**
 * v0.9.16 #142 — workspace icon save round-trip.
 *
 * Asserts the settings PATCH route persists `icon` and that the General loader
 * reads it back. The save path is: settings-form PATCH → route Body.icon →
 * updateWorkspaceSettings(patch.icon) → workspaces.icon → loadWorkspaceGeneralSettings.
 *
 * Mirrors the tests/api/workspace-settings.test.ts harness (real Postgres +
 * route handler invoked directly, with auth/headers mocked).
 */
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { loadWorkspaceGeneralSettings } from '@/lib/workspaces/settings';
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
async function patch(workspaceId: string, body: unknown) {
  const { PATCH } = await import('@/app/api/workspaces/[id]/settings/route');
  const res = await PATCH(
    new Request(`http://localhost/api/workspaces/${workspaceId}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: workspaceId }) },
  );
  return { status: res.status };
}

describe('PATCH /api/workspaces/[id]/settings — icon round-trip (#142)', () => {
  it('persists an emoji icon (200) and the loader reads it back', async () => {
    const w = await ws();
    const owner = await user('owner');
    await add(w, owner, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: owner });

    const r = await patch(w, { icon: 'emoji::🚀' });
    expect(r.status).toBe(200);

    const [row] = await getDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, w));
    expect(row?.icon).toBe('emoji::🚀');

    const settings = await loadWorkspaceGeneralSettings(getDb(), w);
    expect(settings?.icon).toBe('emoji::🚀');
  });

  it('clears the icon when null is sent', async () => {
    const w = await ws();
    const owner = await user('owner');
    await add(w, owner, 'admin');
    active = { name: 'cairn_ws', value: w };
    await setUser({ userId: owner });

    await patch(w, { icon: 'emoji::🚀' });
    const r = await patch(w, { icon: null });
    expect(r.status).toBe(200);

    const settings = await loadWorkspaceGeneralSettings(getDb(), w);
    expect(settings?.icon).toBeNull();
  });
});
