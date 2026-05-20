import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

async function call(pageId: string, body: unknown) {
  const { POST } = await import('@/app/api/pages/[pageId]/move/route');
  const res = await POST(
    new Request(`http://localhost/api/pages/${pageId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ pageId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('POST /api/pages/[pageId]/move', () => {
  it('editor can reparent', async () => {
    const u = await asUser('editor');
    const a = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const b = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call(b.id, { newParentId: a.id });
    expect(r.status).toBe(204);
  });

  it('viewer is 403', async () => {
    const u = await asUser('viewer');
    const a = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call(a.id, { newParentId: null });
    expect(r.status).toBe(403);
  });

  it('400 on cycle', async () => {
    const u = await asUser('editor');
    const a = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const b = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: a.id,
    });
    const r = await call(a.id, { newParentId: b.id });
    expect(r.status).toBe(400);
  });
});
