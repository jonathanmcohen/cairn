import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role, defaultPageStatus: 'published' });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(query: string) {
  const { GET } = await import('@/app/api/search/route');
  const res = await GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}`));
  return { status: res.status, body: await res.json() };
}

describe('GET /api/search', () => {
  it('viewer can search', async () => {
    const u = await asUser('viewer');
    await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Roadmap',
    });
    const r = await call('roadmap');
    expect(r.status).toBe(200);
    const body = r.body as { results: { title: string }[] };
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]?.title).toBe('Roadmap');
  });

  it('unauthenticated is 401', async () => {
    const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: null) => void };
    mod.__set(null);
    const r = await call('foo');
    expect(r.status).toBe(401);
  });

  it('empty query returns empty results', async () => {
    await asUser('viewer');
    const r = await call('');
    expect(r.status).toBe(200);
    expect((r.body as { results: unknown[] }).results).toEqual([]);
  });
});
