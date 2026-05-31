/**
 * G16 #163 — `/api/pages/[pageId]/status` route tests.
 *
 * GET returns the current status; POST drives an allowed lifecycle transition
 * through `transitionStatus`. Mirrors the harness in pages-approval.test.ts.
 */
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, audit_log RESTART IDENTITY CASCADE`;
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

async function makePage(workspaceId: string, userId: string, status: schema.PageStatus = 'draft') {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', status, createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

async function memberUser(workspaceId: string, role: schema.MemberRole) {
  const [u] = await getDb()
    .insert(schema.users)
    .values({ email: `${role}-${Date.now()}-${Math.random()}@x`, passwordHash: 'h', name: role })
    .returning({ id: schema.users.id });
  if (!u) throw new Error('user insert failed');
  await getDb().insert(schema.workspaceMembers).values({ workspaceId, userId: u.id, role });
  return u.id;
}

describe('GET /api/pages/[pageId]/status', () => {
  it('viewer gets 200 with current status', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const page = await makePage(u.workspaceId, u.userId, 'draft');

    const { GET } = await import('@/app/api/pages/[pageId]/status/route');
    const res = await GET(new Request(`http://localhost/api/pages/${page.id}/status`), {
      params: Promise.resolve({ pageId: page.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('draft');
  });
});

describe('POST /api/pages/[pageId]/status', () => {
  it('editor transitions draft → review (200 + audit row)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const editorId = await memberUser(owner.workspaceId, 'editor');
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: editorId });
    const page = await makePage(owner.workspaceId, owner.userId, 'draft');

    const { POST } = await import('@/app/api/pages/[pageId]/status/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'review' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('review');

    const audits = (
      await getDb()
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, 'page.status_changed'))
    ).map((a) => a.action);
    expect(audits).toContain('page.status_changed');
  });

  it('illegal review → archived returns 409', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const editorId = await memberUser(owner.workspaceId, 'editor');
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: editorId });
    const page = await makePage(owner.workspaceId, owner.userId, 'review');

    const { POST } = await import('@/app/api/pages/[pageId]/status/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'archived' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(409);
  });

  it('viewer cannot transition → 403', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const viewerId = await memberUser(owner.workspaceId, 'viewer');
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: viewerId });
    const page = await makePage(owner.workspaceId, owner.userId, 'draft');

    const { POST } = await import('@/app/api/pages/[pageId]/status/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'review' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('unknown status value → 400', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const editorId = await memberUser(owner.workspaceId, 'editor');
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: editorId });
    const page = await makePage(owner.workspaceId, owner.userId, 'draft');

    const { POST } = await import('@/app/api/pages/[pageId]/status/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'banana' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(400);
  });
});
