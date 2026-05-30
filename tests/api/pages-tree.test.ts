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
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function call() {
  const { GET } = await import('@/app/api/pages/tree/route');
  const res = await GET(new Request('http://localhost/api/pages/tree'));
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
}

describe('GET /api/pages/tree', () => {
  it('returns the flattened page tree for the active workspace', async () => {
    const u = await asUser('viewer');
    const a = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: a.id,
    });
    const r = await call();
    expect(r.status).toBe(200);
    const nodes = (r.body as { nodes: Array<{ id: string; depth: number }> }).nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.depth)).toEqual([0, 1]);
    expect(nodes[0]?.id).toBe(a.id);
  });

  it('401 when unauthenticated', async () => {
    const mod = (await import('@/lib/auth/config')) as unknown as {
      __set: (c: { userId: string } | null) => void;
    };
    mod.__set(null);
    const r = await call();
    expect(r.status).toBe(401);
  });
});
