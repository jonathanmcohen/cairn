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
  await sql`TRUNCATE pages, audit_log, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setUser(c: { userId: string } | null): Promise<void> {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(c);
}

async function asEditor(): Promise<{ userId: string; workspaceId: string }> {
  const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
  await setUser({ userId: u.userId });
  return { userId: u.userId, workspaceId: u.workspaceId };
}

describe('POST /api/inbox', () => {
  it('JSON: captures via JSON body and returns the new page id', async () => {
    await asEditor();

    const { POST } = await import('@/app/api/inbox/route');
    const res = await POST(
      new Request('http://localhost/api/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'A', body: 'B', url: 'https://example.com' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { capturedPageId: string; inboxPageId: string };
    expect(body.capturedPageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.inboxPageId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('multipart: captures via share-sheet form params (title, text, url)', async () => {
    await asEditor();

    const form = new FormData();
    form.set('title', 'Shared');
    form.set('text', 'Excerpt');
    form.set('url', 'https://example.org');

    const { POST } = await import('@/app/api/inbox/route');
    const res = await POST(
      new Request('http://localhost/api/inbox', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { capturedPageId: string };
    expect(body.capturedPageId).toMatch(/^[0-9a-f-]{36}$/);

    // Confirm the multipart path recorded sourceUrl + body text on the row.
    const rows = await getDb().select().from(schema.pages);
    const captured = rows.find((r) => r.id === body.capturedPageId);
    expect(captured).toBeDefined();
    expect(captured?.title).toBe('Shared');
    const meta = captured?.metadata as { inbox?: boolean; sourceUrl?: string };
    expect(meta.inbox).toBe(true);
    expect(meta.sourceUrl).toBe('https://example.org');
  });

  it('returns 401 when unauthenticated', async () => {
    await setUser(null);

    const { POST } = await import('@/app/api/inbox/route');
    const res = await POST(
      new Request('http://localhost/api/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'X', body: '', url: null }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when authenticated user has no workspace membership', async () => {
    // Insert a user with no membership rows → getAuthContext returns
    // workspaceId: null, route refuses with 401.
    const [u] = await getDb()
      .insert(schema.users)
      .values({ email: 'orphan@x.com', passwordHash: 'h', name: 'orphan' })
      .returning();
    if (!u) throw new Error('user insert failed');
    await setUser({ userId: u.id });

    const { POST } = await import('@/app/api/inbox/route');
    const res = await POST(
      new Request('http://localhost/api/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'X', body: '', url: null }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid JSON shape', async () => {
    await asEditor();

    const { POST } = await import('@/app/api/inbox/route');
    const res = await POST(
      new Request('http://localhost/api/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 12345 }), // url must be string-or-null
      }),
    );
    expect(res.status).toBe(400);
  });
});
