import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintKey } from '@/lib/api/keys';
import { __resetBuckets } from '@/lib/api/rate-limit';
import type { MemberRole } from '@/lib/auth/require-role';
import { lockPage } from '@/lib/pages/lock';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, api_keys RESTART IDENTITY CASCADE`;
  __resetBuckets();
});

async function keyFor(role: MemberRole) {
  const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
  const { token } = await mintKey(getDb(), {
    workspaceId: u.workspaceId,
    name: 'k',
    role,
    createdBy: u.userId,
  });
  return { token, u };
}

function call(method: string, path: string, token: string | null, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('/api/v1/pages', () => {
  it('401 without a key', async () => {
    const { POST } = await import('@/app/api/v1/pages/route');
    const res = await POST(call('POST', '/api/v1/pages', null, {}));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('editor key creates and lists pages with a cursor', async () => {
    const { token } = await keyFor('editor');
    const routes = await import('@/app/api/v1/pages/route');
    for (let i = 0; i < 3; i++) {
      const c = await routes.POST(call('POST', '/api/v1/pages', token, { title: `P${i}` }));
      expect(c.status).toBe(201);
    }
    const list = await routes.GET(call('GET', '/api/v1/pages?limit=2', token));
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body.data).toHaveLength(2);
    expect(body.nextCursor).toBeTruthy();
  });

  it('viewer key cannot create (403)', async () => {
    const { token } = await keyFor('viewer');
    const { POST } = await import('@/app/api/v1/pages/route');
    const res = await POST(call('POST', '/api/v1/pages', token, {}));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
  });

  it('cross-workspace page id returns 404', async () => {
    const { token } = await keyFor('editor');
    // a page in a DIFFERENT workspace
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const [p] = await getDb()
      .insert(schema.pages)
      .values({ workspaceId: other.workspaceId, title: 'X', createdBy: other.userId })
      .returning();
    if (!p) throw new Error('seed failed');
    const { GET } = await import('@/app/api/v1/pages/[pageId]/route');
    const res = await GET(call('GET', `/api/v1/pages/${p.id}`, token), {
      params: Promise.resolve({ pageId: p.id }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('429 when the per-key rate limit is exceeded', async () => {
    const { token } = await keyFor('viewer');
    const routes = await import('@/app/api/v1/pages/route');
    // capacity is 60; exhaust it then expect a 429.
    let last = await routes.GET(call('GET', '/api/v1/pages', token));
    for (let i = 0; i < 60; i++) {
      last = await routes.GET(call('GET', '/api/v1/pages', token));
    }
    expect(last.status).toBe(429);
    expect(((await last.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('PATCH a page locked by someone else returns 403, not 500', async () => {
    // v0.9.0 G2 P14 review — `PageLockedError` now extends `HttpError`, so the
    // v1 `withApiKey` wrapper maps it to a 403 instead of bubbling to a 500.
    const { token, u } = await keyFor('editor');
    // The PAT itself runs as a separate user; we need the lock to be held by
    // someone OTHER than the PAT's user. Seed an extra user + membership and
    // lock the page as them.
    const [other] = await getDb()
      .insert(schema.users)
      .values({ email: `locker-${Date.now()}@x.com`, passwordHash: 'h', name: 'l' })
      .returning();
    if (!other) throw new Error('seed locker');
    await getDb().insert(schema.workspaceMembers).values({
      workspaceId: u.workspaceId,
      userId: other.id,
      role: 'editor',
    });
    const [page] = await getDb()
      .insert(schema.pages)
      .values({ workspaceId: u.workspaceId, title: 'P', createdBy: other.id })
      .returning();
    if (!page) throw new Error('seed page');
    await lockPage(getDb(), {
      pageId: page.id,
      byUserId: other.id,
      workspaceId: u.workspaceId,
      lockedUntil: null,
    });

    // The PAT was minted at role 'editor' (NOT admin), so `adminOverride` is
    // false and the gate must throw `PageLockedError` → 403 via withApiKey.
    // We need the PAT's owning user to NOT be the locker; `keyFor` uses
    // `createTestWorkspaceWithUser` so `u.userId` !== `other.id`.
    const item = await import('@/app/api/v1/pages/[pageId]/route');
    const res = await item.PATCH(
      call('PATCH', `/api/v1/pages/${page.id}`, token, { title: 'nope' }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('forbidden');
  });

  it('editor key can patch and delete its own page', async () => {
    const { token } = await keyFor('editor');
    const routes = await import('@/app/api/v1/pages/route');
    const created = await routes.POST(call('POST', '/api/v1/pages', token, { title: 'Orig' }));
    const page = (await created.json()) as { id: string };

    const item = await import('@/app/api/v1/pages/[pageId]/route');
    const patched = await item.PATCH(
      call('PATCH', `/api/v1/pages/${page.id}`, token, { title: 'Renamed' }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { title: string }).title).toBe('Renamed');

    const deleted = await item.DELETE(call('DELETE', `/api/v1/pages/${page.id}`, token), {
      params: Promise.resolve({ pageId: page.id }),
    });
    expect(deleted.status).toBe(204);

    const gone = await item.GET(call('GET', `/api/v1/pages/${page.id}`, token), {
      params: Promise.resolve({ pageId: page.id }),
    });
    expect(gone.status).toBe(404);
  });
});
