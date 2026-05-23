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

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function makePage(workspaceId: string, userId: string, title: string) {
  const db = getDb();
  const [p] = await db
    .insert(schema.pages)
    .values({
      workspaceId,
      title,
      createdBy: userId,
      content: { type: 'doc', content: [] } as never,
    })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

async function call(query: string) {
  const { GET } = await import('@/app/api/workspaces/pages/route');
  const res = await GET(
    new Request(`http://localhost/api/workspaces/pages?q=${encodeURIComponent(query)}`),
  );
  return {
    status: res.status,
    body: (await res.json()) as { pages?: { id: string; title: string }[] },
  };
}

describe('GET /api/workspaces/pages', () => {
  it('viewer can search pages of their workspace by title', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    await makePage(u.workspaceId, u.userId, 'Roadmap Q3');
    await setUser(u.userId);
    const r = await call('roadmap');
    expect(r.status).toBe(200);
    expect(r.body.pages?.map((p) => p.title)).toContain('Roadmap Q3');
  });

  it('does not return pages of other workspaces', async () => {
    const mine = await createTestWorkspaceWithUser(getDb());
    const other = await createTestWorkspaceWithUser(getDb());
    await makePage(other.workspaceId, other.userId, 'Secret Plan');
    await setUser(mine.userId);
    const r = await call('secret');
    expect(r.body.pages ?? []).toHaveLength(0);
  });

  it('empty query returns recent pages for the bare picker', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    await makePage(u.workspaceId, u.userId, 'Anything');
    await setUser(u.userId);
    const r = await call('');
    expect(r.status).toBe(200);
    expect((r.body.pages ?? []).length).toBeGreaterThan(0);
  });

  it('excludes soft-deleted pages', async () => {
    const u = await createTestWorkspaceWithUser(getDb());
    const p = await makePage(u.workspaceId, u.userId, 'Trashed Note');
    await getDb()
      .update(schema.pages)
      .set({ deletedAt: new Date() })
      .where(eq(schema.pages.id, p.id));
    await setUser(u.userId);
    const r = await call('trashed');
    expect(r.body.pages ?? []).toHaveLength(0);
  });

  it('unauthenticated is 401', async () => {
    await setUser(null);
    const r = await call('roadmap');
    expect(r.status).toBe(401);
  });
});
