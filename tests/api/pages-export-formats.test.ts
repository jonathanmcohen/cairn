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

async function seedPage() {
  const u = await asUser('viewer');
  const p = await createPage(getDb(), {
    workspaceId: u.workspaceId,
    createdBy: u.userId,
    title: 'Export Me',
  });
  await updatePage(getDb(), {
    pageId: p.id,
    workspaceId: u.workspaceId,
    byUserId: u.userId,
    adminOverride: true,
    patch: {
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Section' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello body' }] },
        ],
      },
    },
  });
  return p.id;
}

describe('GET /api/pages/[id]/export — html + docx formats (#56)', () => {
  it('format=html returns themed HTML with attachment disposition (#56)', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request('http://t/?format=html'), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-disposition')).toContain('.html');
    expect(await res.text()).toContain('<!doctype html>');
  });

  it('format=docx returns an OOXML attachment (#56)', async () => {
    const pageId = await seedPage();
    const { GET } = await import('@/app/api/pages/[pageId]/export/route');
    const res = await GET(new Request('http://t/?format=docx'), {
      params: Promise.resolve({ pageId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('officedocument.wordprocessingml.document');
    expect(res.headers.get('content-disposition')).toContain('.docx');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });
});
