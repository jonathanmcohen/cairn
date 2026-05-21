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
  const { POST } = await import('@/app/api/pages/[pageId]/import/route');
  const res = await POST(
    new Request(`http://localhost/api/pages/${pageId}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ pageId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('POST /api/pages/[id]/import', () => {
  it('editor imports markdown', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call(p.id, { markdown: '# Hello\n\nWorld' });
    expect(r.status).toBe(200);
    const body = r.body as { contentText?: string; content?: { content?: { type: string }[] } };
    expect(body.content?.content?.[0]?.type).toBe('heading');
  });

  it('viewer is 403', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call(p.id, { markdown: '# X' });
    expect(r.status).toBe(403);
  });

  it('rejects oversized markdown with 400', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await call(p.id, { markdown: 'x'.repeat(5_000_001) });
    expect(r.status).toBe(400);
  });
});
