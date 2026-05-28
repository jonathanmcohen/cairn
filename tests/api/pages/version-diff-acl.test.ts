import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDiffData } from '@/app/(app)/pages/[pageId]/versions/diff/page';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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
}, 60_000);

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, page_versions, workspaces, users, workspace_members, sessions, accounts, audit_log RESTART IDENTITY CASCADE`;
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

async function setSession(userId: string) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

async function makePage(workspaceId: string, userId: string) {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({
      workspaceId,
      title: 'p',
      createdBy: userId,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      contentText: '',
    })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

async function insertVersion(pageId: string, authorId: string, content: unknown): Promise<string> {
  const [row] = await getDb()
    .insert(schema.pageVersions)
    .values({ pageId, authorId, content: content as Record<string, unknown> })
    .returning();
  if (!row) throw new Error('version insert failed');
  return row.id;
}

describe('version-diff data loader', () => {
  it('returns the two snapshots + computed diff for an authorized viewer', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession(owner.userId);
    const page = await makePage(owner.workspaceId, owner.userId);
    const aId = await insertVersion(page.id, owner.userId, {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: {}, content: [{ type: 'text', text: 'old' }] }],
    });
    const bId = await insertVersion(page.id, owner.userId, {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: {}, content: [{ type: 'text', text: 'new' }] }],
    });

    const result = await loadDiffData({ pageId: page.id, a: aId, b: bId });
    expect(result.diff).toHaveLength(1);
    expect(result.diff[0]?.kind).toBe('changed');
  });

  it('throws on cross-workspace access (404 surface)', async () => {
    const home = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const other = await createTestWorkspaceWithUser(getDb(), {
      role: 'owner',
      email: 'other@example.com',
    });
    await setSession(home.userId);
    const otherPage = await makePage(other.workspaceId, other.userId);
    const v = await insertVersion(otherPage.id, other.userId, { type: 'doc', content: [] });

    await expect(loadDiffData({ pageId: otherPage.id, a: v, b: v })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws when a version id does not belong to the page (404)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession(owner.userId);
    const page1 = await makePage(owner.workspaceId, owner.userId);
    const page2 = await makePage(owner.workspaceId, owner.userId);
    const v1 = await insertVersion(page1.id, owner.userId, { type: 'doc', content: [] });
    const v2 = await insertVersion(page2.id, owner.userId, { type: 'doc', content: [] });

    await expect(loadDiffData({ pageId: page1.id, a: v1, b: v2 })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws on missing query params (400)', async () => {
    const owner = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    await setSession(owner.userId);
    const page = await makePage(owner.workspaceId, owner.userId);
    await expect(
      loadDiffData({ pageId: page.id, a: undefined, b: undefined }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
