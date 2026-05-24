import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

const flushSetImmediate = () => new Promise<void>((r) => setImmediate(r));

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

describe('page update on-write embedding hook', () => {
  let workspaceId: string;
  let pageId: string;

  beforeEach(async () => {
    await sql`TRUNCATE page_embeddings, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
    // Seed with the hook disabled so no background work races our setup.
    process.env.CAIRN_DISABLE_EMBED_HOOK = '1';
    const u = await createTestWorkspaceWithUser(db);
    workspaceId = u.workspaceId;
    const p = await createPage(db, { workspaceId, createdBy: u.userId, title: 'P' });
    pageId = p.id;
    // Now enable the hook for the actual test body.
    delete process.env.CAIRN_DISABLE_EMBED_HOOK;
    vi.resetModules();
  });

  it('updatePage returns before the embedding write completes (fire-and-forget)', async () => {
    const embedDone = vi.fn();
    vi.doMock('@/lib/search/embed-page', () => ({
      embedPage: async () => {
        // simulate a slow embed call — the update must have already
        // returned by the time we get here.
        await new Promise((r) => setTimeout(r, 30));
        embedDone();
        return { status: 'embedded', pageId };
      },
    }));
    const { updatePage: reloadedUpdate } = await import('@/lib/pages/update');
    embedDone.mockClear();

    const t0 = Date.now();
    const updated = await reloadedUpdate(db, {
      pageId,
      workspaceId,
      patch: { title: 'New' },
    });
    const tReturned = Date.now() - t0;

    expect(updated.title).toBe('New');
    // The embed call deliberately sleeps 30ms. updatePage must have returned
    // well before then (it dispatches via setImmediate AFTER commit).
    expect(tReturned).toBeLessThan(50);
    expect(embedDone).not.toHaveBeenCalled();

    await flushSetImmediate();
    await new Promise((r) => setTimeout(r, 80));
    expect(embedDone).toHaveBeenCalledOnce();

    vi.doUnmock('@/lib/search/embed-page');
  });

  it('embed-hook errors do not propagate to the caller', async () => {
    vi.doMock('@/lib/search/embed-page', () => ({
      embedPage: () => Promise.reject(new Error('provider down')),
    }));
    const { updatePage: reloadedUpdate } = await import('@/lib/pages/update');
    await expect(
      reloadedUpdate(db, { pageId, workspaceId, patch: { title: 'X' } }),
    ).resolves.toBeDefined();
    await flushSetImmediate();
    await new Promise((r) => setTimeout(r, 20));
    vi.doUnmock('@/lib/search/embed-page');
  });
});

describe('page create on-write embedding hook', () => {
  let workspaceId: string;
  let userId: string;

  beforeEach(async () => {
    await sql`TRUNCATE page_embeddings, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
    process.env.CAIRN_DISABLE_EMBED_HOOK = '1';
    const u = await createTestWorkspaceWithUser(db);
    workspaceId = u.workspaceId;
    userId = u.userId;
    delete process.env.CAIRN_DISABLE_EMBED_HOOK;
    vi.resetModules();
  });

  it('createPage schedules an embedPage call after the txn commits', async () => {
    const embedDone = vi.fn();
    vi.doMock('@/lib/search/embed-page', () => ({
      embedPage: async (_db: unknown, id: string) => {
        embedDone(id);
        return { status: 'embedded', pageId: id };
      },
    }));
    const { createPage: reloadedCreate } = await import('@/lib/pages/create');
    const p = await reloadedCreate(db, { workspaceId, createdBy: userId, title: 'New' });
    expect(p.id).toBeTruthy();
    await flushSetImmediate();
    await new Promise((r) => setTimeout(r, 20));
    expect(embedDone).toHaveBeenCalledWith(p.id);
    vi.doUnmock('@/lib/search/embed-page');
  });
});
