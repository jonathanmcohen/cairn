import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { SNAPSHOT_DEBOUNCE_MS } from '@/lib/pages/versions';
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

async function patch(pageId: string, body: unknown) {
  const mod = await import('@/app/api/pages/[pageId]/route');
  const res = await mod.PATCH(
    new Request(`http://localhost/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ pageId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function listVersionsRoute(pageId: string) {
  const mod = await import('@/app/api/pages/[pageId]/versions/route');
  const res = await mod.GET(new Request(`http://localhost/api/pages/${pageId}/versions`), {
    params: Promise.resolve({ pageId }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function restoreRoute(pageId: string, versionId: string) {
  const mod = await import('@/app/api/pages/[pageId]/versions/[versionId]/restore/route');
  const res = await mod.POST(
    new Request(`http://localhost/api/pages/${pageId}/versions/${versionId}/restore`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ pageId, versionId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

const docA = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
};
const docB = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
};

/** Push a version row's createdAt into the past so the debounce no longer blocks a new snapshot. */
async function ageVersions(pageId: string) {
  await sql`UPDATE page_versions SET created_at = now() - ${`${SNAPSHOT_DEBOUNCE_MS * 2} milliseconds`}::interval WHERE page_id = ${pageId}`;
}

describe('page version routes', () => {
  it('PATCH content snapshots a version', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await patch(p.id, { content: docA });
    expect(r.status).toBe(200);
    const list = await listVersionsRoute(p.id);
    expect(list.status).toBe(200);
    expect((list.body as unknown[]).length).toBe(1);
  });

  it('GET versions lists for viewer+', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await patch(p.id, { content: docA });
    const r = await listVersionsRoute(p.id);
    expect(r.status).toBe(200);
    expect((r.body as unknown[]).length).toBe(1);
  });

  it('GET versions 404 for page in another workspace', async () => {
    await asUser('viewer');
    const other = await createTestWorkspaceWithUser(getDb());
    const p = await createPage(getDb(), {
      workspaceId: other.workspaceId,
      createdBy: other.userId,
    });
    const r = await listVersionsRoute(p.id);
    expect(r.status).toBe(404);
  });

  it('restore route restores content as editor', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await patch(p.id, { content: docA });
    await ageVersions(p.id);
    await patch(p.id, { content: docB });
    const list = await listVersionsRoute(p.id);
    const versions = list.body as Array<{ id: string }>;
    // newest-first: the last entry is the original docA snapshot
    const original = versions.at(-1);
    if (!original) throw new Error('expected a version');
    const r = await restoreRoute(p.id, original.id);
    expect(r.status).toBe(200);
    const get = await import('@/app/api/pages/[pageId]/route');
    const res = await get.GET(new Request(`http://localhost/api/pages/${p.id}`), {
      params: Promise.resolve({ pageId: p.id }),
    });
    const page = (await res.json()) as { contentText: string };
    expect(page.contentText).toContain('A');
  });

  it('restore route 403 for viewer', async () => {
    const u = await asUser('editor');
    const p = await createPage(getDb(), { workspaceId: u.workspaceId, createdBy: u.userId });
    await patch(p.id, { content: docA });
    const list = await listVersionsRoute(p.id);
    const first = (list.body as Array<{ id: string }>).at(0);
    if (!first) throw new Error('expected a version');
    const versionId = first.id;
    // add a viewer to the SAME workspace, then re-auth as them
    const [viewer] = await getDb()
      .insert(schema.users)
      .values({ email: 'viewer-same@example.com', passwordHash: 'h', name: 'viewer' })
      .returning();
    if (!viewer) throw new Error('failed to create viewer');
    await getDb()
      .insert(schema.workspaceMembers)
      .values({ workspaceId: u.workspaceId, userId: viewer.id, role: 'viewer' });
    const mod = (await import('@/lib/auth/config')) as unknown as {
      __set: (c: { userId: string } | null) => void;
    };
    mod.__set({ userId: viewer.id });
    const r = await restoreRoute(p.id, versionId);
    expect(r.status).toBe(403);
  });

  it('restore route 404 for page in another workspace', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const p = await createPage(getDb(), {
      workspaceId: owner.workspaceId,
      createdBy: owner.userId,
    });
    const ownerMod = (await import('@/lib/auth/config')) as unknown as {
      __set: (c: { userId: string } | null) => void;
    };
    ownerMod.__set({ userId: owner.userId });
    await patch(p.id, { content: docA });
    const list = await listVersionsRoute(p.id);
    const first = (list.body as Array<{ id: string }>).at(0);
    if (!first) throw new Error('expected a version');
    const versionId = first.id;
    // switch to an unrelated editor in a different workspace
    await asUser('editor');
    const r = await restoreRoute(p.id, versionId);
    expect(r.status).toBe(404);
  });
});
