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
  await sql`TRUNCATE pages, page_links, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function call(pageId: string) {
  const mod = await import('@/app/api/pages/[pageId]/backlinks/route');
  const res = await mod.GET(new Request(`http://localhost/api/pages/${pageId}/backlinks`), {
    params: Promise.resolve({ pageId }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('/api/pages/[pageId]/backlinks', () => {
  it('GET returns backlinks + unlinkedMentions arrays for a viewer', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call(p.id);
    expect(r.status).toBe(200);
    const body = r.body as { backlinks: unknown[]; unlinkedMentions: unknown[] };
    expect(Array.isArray(body.backlinks)).toBe(true);
    expect(Array.isArray(body.unlinkedMentions)).toBe(true);
  });

  it('GET 404 for a page in another workspace', async () => {
    await asUser('viewer');
    const other = await createTestWorkspaceWithUser(getDb());
    const p = await createPage(getDb(), {
      workspaceId: other.workspaceId,
      createdBy: other.userId,
    });
    const r = await call(p.id);
    expect(r.status).toBe(404);
  });
});
