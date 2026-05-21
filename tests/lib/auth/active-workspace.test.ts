import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, stopPostgres } from '../../helpers/db';

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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, invite_tokens, sessions, accounts RESTART IDENTITY CASCADE`;
  vi.resetModules();
});

// Insert a user with N workspaces, returning ids in creation order (oldest first).
async function setup(opts: { roles: schema.MemberRole[] }) {
  const db = drizzle(sql, { schema });
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `u-${Math.random().toString(36).slice(2)}@x.com`,
      passwordHash: 'h',
      name: 'U',
    })
    .returning();
  if (!user) throw new Error('user insert failed');
  const workspaceIds: string[] = [];
  for (let i = 0; i < opts.roles.length; i++) {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: `WS ${i}`, slug: `ws-${i}-${Math.random().toString(36).slice(2)}` })
      .returning();
    if (!ws) throw new Error('ws insert failed');
    // joinedAt staggered so "oldest" is deterministic.
    await db.insert(schema.workspaceMembers).values({
      workspaceId: ws.id,
      userId: user.id,
      role: opts.roles[i] as schema.MemberRole,
      joinedAt: new Date(Date.now() + i * 1000),
    });
    workspaceIds.push(ws.id);
  }
  return { userId: user.id, workspaceIds };
}

// Load getAuthContext with the session + cookie mocked. `cookieValue` is what
// cookies().get('cairn_ws')?.value returns. Returns the ctx plus a record of any
// cookie writes attempted by getAuthContext's best-effort set.
async function loadCtx(opts: { userId: string | null; cookieValue?: string }) {
  vi.doMock('@/lib/auth/config', () => ({
    auth: async () => (opts.userId ? { user: { id: opts.userId } } : null),
  }));
  const sets: { name: string; value: string }[] = [];
  vi.doMock('next/headers', () => ({
    cookies: async () => ({
      get: (name: string) =>
        name === 'cairn_ws' && opts.cookieValue ? { name, value: opts.cookieValue } : undefined,
      set: (name: string, value: string) => {
        sets.push({ name, value });
      },
    }),
  }));
  const mod = await import('@/lib/auth/require-role');
  const ctx = await mod.getAuthContext();
  return { ctx, sets };
}

describe('getAuthContext active-workspace resolution', () => {
  it('returns null when not logged in', async () => {
    const { ctx } = await loadCtx({ userId: null });
    expect(ctx).toBeNull();
  });

  it('valid cookie selects that workspace + its role', async () => {
    const { userId, workspaceIds } = await setup({ roles: ['owner', 'viewer'] });
    const { ctx } = await loadCtx({ userId, cookieValue: workspaceIds[1] });
    expect(ctx).toMatchObject({ userId, workspaceId: workspaceIds[1], role: 'viewer' });
  });

  it('returns the role held in the ACTIVE workspace (owner of one, viewer of another)', async () => {
    const { userId, workspaceIds } = await setup({ roles: ['owner', 'viewer'] });
    const ownerCtx = await loadCtx({ userId, cookieValue: workspaceIds[0] });
    expect(ownerCtx.ctx?.role).toBe('owner');
    vi.resetModules();
    const viewerCtx = await loadCtx({ userId, cookieValue: workspaceIds[1] });
    expect(viewerCtx.ctx?.role).toBe('viewer');
  });

  it('no cookie → falls back to the OLDEST membership and best-effort sets the cookie', async () => {
    const { userId, workspaceIds } = await setup({ roles: ['admin', 'editor'] });
    const { ctx, sets } = await loadCtx({ userId });
    expect(ctx).toMatchObject({ userId, workspaceId: workspaceIds[0], role: 'admin' });
    expect(sets).toContainEqual({ name: 'cairn_ws', value: workspaceIds[0] });
  });

  it('forged / foreign cookie → falls back to the oldest membership', async () => {
    const { userId, workspaceIds } = await setup({ roles: ['editor', 'admin'] });
    const { ctx } = await loadCtx({ userId, cookieValue: '00000000-0000-0000-0000-000000000000' });
    expect(ctx?.workspaceId).toBe(workspaceIds[0]);
    expect(ctx?.role).toBe('editor');
  });

  it('zero memberships → no-workspace context (workspaceId/role null)', async () => {
    const { userId } = await setup({ roles: [] });
    const { ctx } = await loadCtx({ userId });
    expect(ctx).toEqual({ userId, workspaceId: null, role: null });
  });
});
