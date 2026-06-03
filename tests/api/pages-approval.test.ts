/**
 * v0.9.0 G4 P24 — `/api/pages/[pageId]/approval` + `.../decide` route tests.
 *
 * Covers:
 *   - viewer cannot decide (403)
 *   - editor cannot decide (403)
 *   - admin can decide (200 + signed row)
 *   - editor can request approval (200 + status flip)
 *   - GET returns reverse-chronological history
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
  await sql`TRUNCATE page_approvals, page_versions, audit_log, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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
  await getDb()
    .insert(schema.pageVersions)
    .values({ pageId: p.id, content: { type: 'doc', content: [] }, authorId: userId });
  return p;
}

// #270 — a decider can't approve a page they authored. The positive decide
// paths therefore use a separate author user (distinct from the approver).
async function makeAuthor(): Promise<string> {
  const [author] = await getDb()
    .insert(schema.users)
    .values({
      email: `author-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x`,
      passwordHash: 'h',
      name: 'Author',
    })
    .returning({ id: schema.users.id });
  if (!author) throw new Error('author insert failed');
  return author.id;
}

describe('POST /api/pages/[pageId]/approval (request)', () => {
  it('an editor requesting approval → 200 and status flips to review', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const page = await makePage(u.workspaceId, u.userId, 'draft');

    const { POST } = await import('@/app/api/pages/[pageId]/approval/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/approval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'request' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);

    const [refreshed] = await getDb()
      .select({ status: schema.pages.status })
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(refreshed?.status).toBe('review');
  });

  it('a viewer cannot request → 403', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [viewer] = await getDb()
      .insert(schema.users)
      .values({ email: `v-${Date.now()}@x`, passwordHash: 'h', name: 'V' })
      .returning({ id: schema.users.id });
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: owner.workspaceId, userId: viewer!.id, role: 'viewer' });
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: viewer!.id });
    const page = await makePage(owner.workspaceId, owner.userId, 'draft');

    const { POST } = await import('@/app/api/pages/[pageId]/approval/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/approval`, {
        method: 'POST',
        body: JSON.stringify({ action: 'request' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/pages/[pageId]/approval/decide', () => {
  it('a viewer cannot decide → 403', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [viewer] = await getDb()
      .insert(schema.users)
      .values({ email: `v-${Date.now()}@x`, passwordHash: 'h', name: 'V' })
      .returning({ id: schema.users.id });
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: owner.workspaceId, userId: viewer!.id, role: 'viewer' });
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: viewer!.id });
    const page = await makePage(owner.workspaceId, owner.userId, 'review');

    const { POST } = await import('@/app/api/pages/[pageId]/approval/decide/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/approval/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'approved' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('an editor cannot decide → 403', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const [ed] = await getDb()
      .insert(schema.users)
      .values({ email: `e-${Date.now()}@x`, passwordHash: 'h', name: 'E' })
      .returning({ id: schema.users.id });
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: owner.workspaceId, userId: ed!.id, role: 'editor' });
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: ed!.id });
    const page = await makePage(owner.workspaceId, owner.userId, 'review');

    const { POST } = await import('@/app/api/pages/[pageId]/approval/decide/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/approval/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'approved' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('an admin/owner can decide → 200, signed row, audit emitted', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const page = await makePage(u.workspaceId, await makeAuthor(), 'review');

    const { POST } = await import('@/app/api/pages/[pageId]/approval/decide/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/approval/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'approved', comment: 'lgtm' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signatureHmac: string };
    expect(body.signatureHmac).toMatch(/^[0-9a-f]{64}$/);

    const audits = (
      await getDb()
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.workspaceId, u.workspaceId))
    ).map((a) => a.action);
    expect(audits).toContain('page.approved');
  });

  it('rejects an unknown decision value → 400', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const page = await makePage(u.workspaceId, u.userId, 'review');

    const { POST } = await import('@/app/api/pages/[pageId]/approval/decide/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/approval/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'invalid-decision' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/pages/[pageId]/approval (history)', () => {
  it('returns reverse-chronological signed history', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    cookieVal.ws = u.workspaceId;
    await setUser({ userId: u.userId });
    const page = await makePage(u.workspaceId, await makeAuthor(), 'review');

    const { POST: decideRoute } = await import('@/app/api/pages/[pageId]/approval/decide/route');
    await decideRoute(
      new Request(`http://localhost/api/pages/${page.id}/approval/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'approved', comment: 'first pass' }),
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );

    const { GET } = await import('@/app/api/pages/[pageId]/approval/route');
    const res = await GET(new Request(`http://localhost/api/pages/${page.id}/approval`), {
      params: Promise.resolve({ pageId: page.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      history: Array<{ decision: string; comment: string | null; signatureHmac: string }>;
    };
    expect(body.history).toHaveLength(1);
    expect(body.history[0]!.decision).toBe('approved');
    expect(body.history[0]!.comment).toBe('first pass');
    expect(body.history[0]!.signatureHmac).toMatch(/^[0-9a-f]{64}$/);
  });
});
