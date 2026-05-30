import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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
  await sql`TRUNCATE pages, page_versions, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function setUser(userId: string) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

async function snapshotRoute(pageId: string) {
  const mod = await import('@/app/api/pages/[pageId]/versions/snapshot/route');
  const res = await mod.POST(
    new Request(`http://localhost/api/pages/${pageId}/versions/snapshot`, { method: 'POST' }),
    { params: Promise.resolve({ pageId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

const docA = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
};

/** Set the live page content directly (createPage always seeds an empty doc). */
async function setContent(pageId: string, content: unknown) {
  await sql`UPDATE pages SET content = ${sql.json(content as never)} WHERE id = ${pageId}`;
}

describe('POST /api/pages/[pageId]/versions/snapshot', () => {
  it('201 with the inserted version for an editor (forces past the debounce)', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await setContent(p.id, docA);
    const r = await snapshotRoute(p.id);
    expect(r.status).toBe(201);
    expect((r.body as { id?: string }).id).toBeTruthy();
  });

  it('200 + { skipped: true } when content is unchanged from the latest', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await setContent(p.id, docA);
    const first = await snapshotRoute(p.id);
    expect(first.status).toBe(201);
    // Second snapshot — same content, so dedupe skips even though force bypasses debounce.
    const second = await snapshotRoute(p.id);
    expect(second.status).toBe(200);
    expect((second.body as { skipped?: boolean }).skipped).toBe(true);
  });

  it('403 for a viewer', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await setContent(p.id, docA);
    // add a viewer to the SAME workspace, then re-auth as them
    const [viewer] = await getDb()
      .insert((await import('@/db/schema')).users)
      .values({ email: 'viewer-snap@example.com', passwordHash: 'h', name: 'viewer' })
      .returning();
    if (!viewer) throw new Error('failed to create viewer');
    await getDb()
      .insert((await import('@/db/schema')).workspaceMembers)
      .values({ workspaceId: u.workspaceId, userId: viewer.id, role: 'viewer' });
    await setUser(viewer.id);
    const r = await snapshotRoute(p.id);
    expect(r.status).toBe(403);
  });

  it('404 for a page in another workspace', async () => {
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const p = await createPage(getDb(), {
      workspaceId: other.workspaceId,
      createdBy: other.userId,
    });
    await setContent(p.id, docA);
    await asUser('editor'); // unrelated editor in a different workspace
    const r = await snapshotRoute(p.id);
    expect(r.status).toBe(404);
  });
});
