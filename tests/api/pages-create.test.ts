import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
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

async function call(body: unknown): Promise<{ status: number; body: unknown }> {
  const { POST } = await import('@/app/api/pages/route');
  const res = await POST(
    new Request('http://localhost/api/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

describe('POST /api/pages', () => {
  it('editor can create a page', async () => {
    await asUser('editor');
    const r = await call({});
    expect(r.status).toBe(201);
    const body = r.body as { id: string; title: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.title).toBe('Untitled');
  });

  it('editor can create a nested page', async () => {
    await asUser('editor');
    const parent = await call({});
    const parentBody = parent.body as { id: string };
    const r = await call({ parentId: parentBody.id, title: 'Child' });
    expect(r.status).toBe(201);
    expect((r.body as { title: string }).title).toBe('Child');
  });

  it('viewer is forbidden', async () => {
    await asUser('viewer');
    const r = await call({});
    expect(r.status).toBe(403);
  });

  it('unauthenticated is 401', async () => {
    const mod = (await import('@/lib/auth/config')) as unknown as { __set: (c: null) => void };
    mod.__set(null);
    const r = await call({});
    expect(r.status).toBe(401);
  });
});
