/**
 * G16 #163 — `/api/pages/[pageId]/translations` route tests.
 *
 * GET lists pages linked to the same canonical; POST links this page as a
 * translation of a canonical via `linkTranslation`. Mirrors the harness in
 * pages-status.test.ts.
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

async function makePage(workspaceId: string, userId: string, title = 'P') {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title, createdBy: userId })
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

describe('POST /api/pages/[pageId]/translations', () => {
  it('editor links pageB as a translation of pageA (200, sets cols, audit)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const editorId = await memberUser(owner.workspaceId, 'editor');
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: editorId });
    const pageA = await makePage(owner.workspaceId, owner.userId, 'Canonical');
    const pageB = await makePage(owner.workspaceId, owner.userId, 'Hola');

    const { POST } = await import('@/app/api/pages/[pageId]/translations/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${pageB.id}/translations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonicalPageId: pageA.id, locale: 'es' }),
      }),
      { params: Promise.resolve({ pageId: pageB.id }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [refreshed] = await getDb()
      .select({
        of: schema.pages.translationOfPageId,
        loc: schema.pages.translationLocale,
      })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageB.id));
    expect(refreshed?.of).toBe(pageA.id);
    expect(refreshed?.loc).toBe('es');

    const audits = (
      await getDb()
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, 'page.translation_linked'))
    ).map((a) => a.action);
    expect(audits).toContain('page.translation_linked');
  });

  it('linking a page to itself → 400', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const editorId = await memberUser(owner.workspaceId, 'editor');
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: editorId });
    const pageA = await makePage(owner.workspaceId, owner.userId);

    const { POST } = await import('@/app/api/pages/[pageId]/translations/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${pageA.id}/translations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonicalPageId: pageA.id, locale: 'es' }),
      }),
      { params: Promise.resolve({ pageId: pageA.id }) },
    );
    expect(res.status).toBe(400);
  });

  it('viewer cannot link → 403', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const viewerId = await memberUser(owner.workspaceId, 'viewer');
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: viewerId });
    const pageA = await makePage(owner.workspaceId, owner.userId, 'Canonical');
    const pageB = await makePage(owner.workspaceId, owner.userId, 'Hola');

    const { POST } = await import('@/app/api/pages/[pageId]/translations/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${pageB.id}/translations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonicalPageId: pageA.id, locale: 'es' }),
      }),
      { params: Promise.resolve({ pageId: pageB.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('canonical in another workspace → 400 (cross-workspace guard / not reachable)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const editorId = await memberUser(owner.workspaceId, 'editor');
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: editorId });
    const pageB = await makePage(owner.workspaceId, owner.userId, 'Hola');
    const foreign = await makePage(other.workspaceId, other.userId, 'Foreign');

    const { POST } = await import('@/app/api/pages/[pageId]/translations/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${pageB.id}/translations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonicalPageId: foreign.id, locale: 'es' }),
      }),
      { params: Promise.resolve({ pageId: pageB.id }) },
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/pages/[pageId]/translations', () => {
  it('lists linked translations of the canonical', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const editorId = await memberUser(owner.workspaceId, 'editor');
    cookieVal.ws = owner.workspaceId;
    await setUser({ userId: editorId });
    const pageA = await makePage(owner.workspaceId, owner.userId, 'Canonical');
    const pageB = await makePage(owner.workspaceId, owner.userId, 'Hola');

    const { POST, GET } = await import('@/app/api/pages/[pageId]/translations/route');
    await POST(
      new Request(`http://localhost/api/pages/${pageB.id}/translations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canonicalPageId: pageA.id, locale: 'es' }),
      }),
      { params: Promise.resolve({ pageId: pageB.id }) },
    );

    const res = await GET(new Request(`http://localhost/api/pages/${pageA.id}/translations`), {
      params: Promise.resolve({ pageId: pageA.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      translations: Array<{ id: string; title: string; locale: string | null }>;
    };
    const found = body.translations.find((t) => t.id === pageB.id);
    expect(found).toBeTruthy();
    expect(found?.title).toBe('Hola');
    expect(found?.locale).toBe('es');
  });
});
