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

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function makePage(workspaceId: string, userId: string) {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title: 'Roadmap', createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

async function publish(pageId: string) {
  const { POST } = await import('@/app/api/pages/[pageId]/publish/route');
  const res = await POST(
    new Request(`http://localhost/api/pages/${pageId}/publish`, { method: 'POST' }),
    {
      params: Promise.resolve({ pageId }),
    },
  );
  return { status: res.status, body: await res.json() };
}

async function unpublish(pageId: string) {
  const { POST } = await import('@/app/api/pages/[pageId]/unpublish/route');
  const res = await POST(
    new Request(`http://localhost/api/pages/${pageId}/unpublish`, { method: 'POST' }),
    {
      params: Promise.resolve({ pageId }),
    },
  );
  return { status: res.status, body: await res.json() };
}

describe('POST /api/pages/[pageId]/publish', () => {
  it('editor publishes → 200 with slug + url', async () => {
    const u = await asUser('editor');
    const page = await makePage(u.workspaceId, u.userId);
    const r = await publish(page.id);
    expect(r.status).toBe(200);
    const body = r.body as { slug: string; url: string };
    expect(body.slug).toMatch(/^roadmap-[0-9a-f]{6}$/);
    expect(body.url).toBe(`/p/${body.slug}`);
  });

  it('viewer is forbidden (403)', async () => {
    const u = await asUser('viewer');
    const page = await makePage(u.workspaceId, u.userId);
    const r = await publish(page.id);
    expect(r.status).toBe(403);
  });
});

describe('GET /api/pages/[pageId]/publish (preview)', () => {
  it('GET preview returns predicted url without publishing (#70/#249)', async () => {
    const u = await asUser('editor');
    const page = await makePage(u.workspaceId, u.userId);
    const { GET } = await import('@/app/api/pages/[pageId]/publish/route');
    const res = await GET(new Request('http://t/'), {
      params: Promise.resolve({ pageId: page.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slug: string; url: string; minted: boolean };
    expect(body.url).toBe(`/p/${body.slug}`);
    expect(body.slug).toBe('roadmap');
    expect(body.minted).toBe(false);
    const [row] = await getDb().select().from(schema.pages).where(eq(schema.pages.id, page.id));
    expect(row?.published).toBe(false);
    expect(row?.publicSlug).toBeNull();
  });
});

describe('POST /api/pages/[pageId]/unpublish', () => {
  it('editor unpublishes → 200', async () => {
    const u = await asUser('editor');
    const page = await makePage(u.workspaceId, u.userId);
    await publish(page.id);
    const r = await unpublish(page.id);
    expect(r.status).toBe(200);
    expect((r.body as { ok: boolean }).ok).toBe(true);
  });
});
