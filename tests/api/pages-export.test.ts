import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { updatePage } from '@/lib/pages/update';
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

describe('GET /api/pages/[id]/export', () => {
  it('returns the page as markdown', async () => {
    const u = await asUser('viewer');
    const p = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'X',
    });
    await updatePage(getDb(), {
      pageId: p.id,
      workspaceId: u.workspaceId,
      patch: {
        content: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H' }] },
          ],
        },
      },
    });
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request(`http://localhost/api/pages/${p.id}/export`), {
      params: Promise.resolve({ pageId: p.id }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('markdown');
    const text = await res.text();
    expect(text).toContain('# H');
  });

  it('returns a zip for recursive=true', async () => {
    const u = await asUser('viewer');
    const root = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Root',
    });
    await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'Child',
    });
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(
      new Request(`http://localhost/api/pages/${root.id}/export?recursive=true`),
      { params: Promise.resolve({ pageId: root.id }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
  });
});
