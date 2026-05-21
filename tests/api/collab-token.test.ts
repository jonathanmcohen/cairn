import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { verifyCollabToken } from '@/lib/collab/token';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
const SECRET = 'x'.repeat(32);

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = SECRET;
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  process.env.COLLAB_URL = 'ws://localhost:1234';
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

async function signOut() {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(null);
}

async function call(pageId: string | null) {
  const { GET } = await import('@/app/api/collab/token/route');
  const qs = pageId === null ? '' : `?pageId=${pageId}`;
  const res = await GET(new Request(`http://localhost/api/collab/token${qs}`));
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('GET /api/collab/token', () => {
  it('mints an editor-role token for an editor', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'P',
    });
    const { status, body } = await call(p.id);
    expect(status).toBe(200);
    expect(body.collabUrl).toBe('ws://localhost:1234');
    const claims = verifyCollabToken(body.token, SECRET);
    expect(claims).toMatchObject({ userId: u.userId, pageId: p.id, role: 'editor' });
  });

  it('mints a viewer-role token for a viewer', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'P',
    });
    const { status, body } = await call(p.id);
    expect(status).toBe(200);
    expect(verifyCollabToken(body.token, SECRET)?.role).toBe('viewer');
  });

  it('returns 400 when pageId is missing', async () => {
    await asUser('editor');
    const { status } = await call(null);
    expect(status).toBe(400);
  });

  it('returns 404 for a page in another workspace / nonexistent', async () => {
    await asUser('editor');
    const { status } = await call('00000000-0000-0000-0000-000000000000');
    expect(status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    await signOut();
    const { status } = await call('00000000-0000-0000-0000-000000000000');
    expect(status).toBe(401);
  });
});
