import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
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
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

describe('trash routes', () => {
  it('GET /api/trash lists deleted_root pages for viewer', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'X',
    });
    await softDeletePage(getDb(), { pageId: p.id, workspaceId: u.workspaceId });
    const { GET } = await import('@/app/api/trash/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { id: string }[] };
    expect(body.entries).toHaveLength(1);
  });

  it('POST /api/pages/[pageId]/restore restores as editor', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(getDb(), { pageId: p.id, workspaceId: u.workspaceId });
    const { POST } = await import('@/app/api/pages/[pageId]/restore/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${p.id}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ pageId: p.id }) },
    );
    expect(res.status).toBe(204);
  });

  it('POST restore: viewer is 403', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(getDb(), { pageId: p.id, workspaceId: u.workspaceId });
    const { POST } = await import('@/app/api/pages/[pageId]/restore/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${p.id}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ pageId: p.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('DELETE /api/trash/[pageId] hard-deletes as editor', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(getDb(), { pageId: p.id, workspaceId: u.workspaceId });
    const { DELETE } = await import('@/app/api/trash/[pageId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/trash/${p.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ pageId: p.id }) },
    );
    expect(res.status).toBe(204);
  });

  it('DELETE /api/trash/[pageId]: viewer is 403', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await softDeletePage(getDb(), { pageId: p.id, workspaceId: u.workspaceId });
    const { DELETE } = await import('@/app/api/trash/[pageId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/trash/${p.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ pageId: p.id }) },
    );
    expect(res.status).toBe(403);
  });
});
