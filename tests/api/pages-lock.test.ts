/**
 * v0.9.0 G2 P14 — `POST/DELETE /api/pages/[pageId]/lock` route tests.
 *
 * Covers the lock + unlock happy paths, an admin-override unlock, the lock-by-
 * non-editor 403, and the unlock-by-non-locker 403 (with admin override
 * bypass).
 */
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { lockPage } from '@/lib/pages/lock';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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

const cookieVal = { ws: '' };
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
  cookies: async () => ({
    get: (name: string) =>
      name === 'cairn_ws' && cookieVal.ws ? { name, value: cookieVal.ws } : undefined,
    set: () => {},
  }),
}));

async function setUser(c: { userId: string } | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(c);
}

async function makePage(workspaceId: string, userId: string) {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

describe('POST /api/pages/[pageId]/lock', () => {
  it('an editor locks their own page → 200, lock row populated, audit emitted', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const page = await makePage(u.workspaceId, u.userId);

    const { POST } = await import('@/app/api/pages/[pageId]/lock/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/lock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);

    const [row] = await getDb()
      .select({ lockedAt: schema.pages.lockedAt, lockedBy: schema.pages.lockedBy })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(row?.lockedAt).not.toBeNull();
    expect(row?.lockedBy).toBe(u.userId);

    const audits = await getDb()
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId));
    expect(audits.map((a) => a.action)).toContain('page.locked');
  });

  it('accepts a lockedUntil cutoff and persists it', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const page = await makePage(u.workspaceId, u.userId);
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const { POST } = await import('@/app/api/pages/[pageId]/lock/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/lock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lockedUntil: until }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);

    const [row] = await getDb()
      .select({ lockedUntil: schema.pages.lockedUntil })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(row?.lockedUntil).not.toBeNull();
  });

  it('a viewer is refused with 403', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const page = await makePage(u.workspaceId, u.userId);

    const { POST } = await import('@/app/api/pages/[pageId]/lock/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/lock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/pages/[pageId]/lock', () => {
  it('the locker unlocks → 200, lock cleared, audit emitted', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const page = await makePage(u.workspaceId, u.userId);
    await lockPage(getDb(), {
      pageId: page.id,
      byUserId: u.userId,
      workspaceId: u.workspaceId,
    });

    const { DELETE } = await import('@/app/api/pages/[pageId]/lock/route');
    const res = await DELETE(
      new Request(`http://localhost/api/pages/${page.id}/lock`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);

    const [row] = await getDb()
      .select({ lockedAt: schema.pages.lockedAt })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(row?.lockedAt).toBeNull();
  });

  it('non-locker editor cannot unlock → 403', async () => {
    const locker = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const [other] = await getDb()
      .insert(schema.users)
      .values({ email: 'b@x.com', passwordHash: 'h', name: 'b' })
      .returning();
    if (!other) throw new Error('seed user');
    await getDb().insert(schema.workspaceMembers).values({
      workspaceId: locker.workspaceId,
      userId: other.id,
      role: 'editor',
    });
    const page = await makePage(locker.workspaceId, locker.userId);
    await lockPage(getDb(), {
      pageId: page.id,
      byUserId: locker.userId,
      workspaceId: locker.workspaceId,
    });

    cookieVal.ws = locker.workspaceId;
    await setUser({ userId: other.id });
    const { DELETE } = await import('@/app/api/pages/[pageId]/lock/route');
    const res = await DELETE(
      new Request(`http://localhost/api/pages/${page.id}/lock`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adminOverride: false }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('an admin force-unlocks → 200 + page.unlock_overridden_by_admin audit', async () => {
    const locker = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const [adminUser] = await getDb()
      .insert(schema.users)
      .values({ email: 'a@x.com', passwordHash: 'h', name: 'a' })
      .returning();
    if (!adminUser) throw new Error('seed user');
    await getDb().insert(schema.workspaceMembers).values({
      workspaceId: locker.workspaceId,
      userId: adminUser.id,
      role: 'admin',
    });
    const page = await makePage(locker.workspaceId, locker.userId);
    await lockPage(getDb(), {
      pageId: page.id,
      byUserId: locker.userId,
      workspaceId: locker.workspaceId,
    });

    cookieVal.ws = locker.workspaceId;
    await setUser({ userId: adminUser.id });
    const { DELETE } = await import('@/app/api/pages/[pageId]/lock/route');
    const res = await DELETE(
      new Request(`http://localhost/api/pages/${page.id}/lock`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adminOverride: true }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);

    const [row] = await getDb()
      .select({ lockedAt: schema.pages.lockedAt })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(row?.lockedAt).toBeNull();

    const audits = await getDb()
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, locker.workspaceId));
    expect(audits.map((a) => a.action)).toContain('page.unlock_overridden_by_admin');
  });

  it('an editor cannot escalate themselves via adminOverride: true', async () => {
    const locker = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const [other] = await getDb()
      .insert(schema.users)
      .values({ email: 'c@x.com', passwordHash: 'h', name: 'c' })
      .returning();
    if (!other) throw new Error('seed user');
    await getDb().insert(schema.workspaceMembers).values({
      workspaceId: locker.workspaceId,
      userId: other.id,
      role: 'editor',
    });
    const page = await makePage(locker.workspaceId, locker.userId);
    await lockPage(getDb(), {
      pageId: page.id,
      byUserId: locker.userId,
      workspaceId: locker.workspaceId,
    });

    cookieVal.ws = locker.workspaceId;
    await setUser({ userId: other.id });
    const { DELETE } = await import('@/app/api/pages/[pageId]/lock/route');
    const res = await DELETE(
      new Request(`http://localhost/api/pages/${page.id}/lock`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adminOverride: true }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
  });
});
