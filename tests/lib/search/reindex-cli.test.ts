import { eq, sql as rawSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { __resetEmbeddingProviderForTests } from '@/lib/search/embed';
import { reindexEmbeddings } from '@/lib/search/reindex-cli';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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

// Helper: drain the on-write embedding hooks scheduled by createPage so
// the reindex tests start from a deterministic state.
const drainHooks = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 30));
};

describe('reindexEmbeddings', () => {
  let workspaceId: string;
  let userId: string;

  beforeEach(async () => {
    await sql`TRUNCATE page_embeddings, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
    // Force the on-write hook ON so createPage's setImmediate writes an
    // embedding row — half these tests depend on that "page already
    // embedded" steady-state.
    delete process.env.CAIRN_DISABLE_EMBED_HOOK;
    const u = await createTestWorkspaceWithUser(db);
    workspaceId = u.workspaceId;
    userId = u.userId;
    delete process.env.CAIRN_EMBEDDING_URL;
    process.env.CAIRN_EMBEDDING_URL = 'http://stub.local/v1/embeddings';
    __resetEmbeddingProviderForTests();
    const fakeVec = Array.from({ length: 384 }, () => 0.1);
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ embedding: fakeVec }] }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  afterAll(() => {
    process.env.CAIRN_DISABLE_EMBED_HOOK = '1';
  });

  it('embeds every page in the workspace that lacks an embedding', async () => {
    // Seed 3 pages, then wipe the on-write-hook embeddings so reindex
    // has a clean backlog to process (mirrors the "post-upgrade backfill"
    // case where pages exist but no embeddings have ever been written).
    for (let i = 0; i < 3; i++) {
      await createPage(db, { workspaceId, createdBy: userId, title: `Page ${i}` });
    }
    await drainHooks();
    await db
      .delete(schema.pageEmbeddings)
      .where(eq(schema.pageEmbeddings.workspaceId, workspaceId));

    const summary = await reindexEmbeddings(db, { workspaceId });
    expect(summary.processed).toBe(3);
    expect(summary.embedded).toBe(3);
    expect(summary.skipped).toBe(0);
    const rows =
      (await sql`select count(*)::int as c from page_embeddings where workspace_id = ${workspaceId}`) as unknown as {
        c: number;
      }[];
    expect(rows[0]?.c).toBe(3);
  });

  it('finds no candidates when every page is already embedded', async () => {
    await createPage(db, { workspaceId, createdBy: userId, title: 'a' });
    await drainHooks();
    // Sanity: the on-write hook already wrote the embedding row.
    const before =
      (await sql`select count(*)::int as c from page_embeddings where workspace_id = ${workspaceId}`) as unknown as {
        c: number;
      }[];
    expect(before[0]?.c).toBe(1);

    const summary = await reindexEmbeddings(db, { workspaceId });
    expect(summary.processed).toBe(0);
    expect(summary.embedded).toBe(0);
  });

  it('re-embeds rows whose content_hash is stale', async () => {
    const p = await createPage(db, { workspaceId, createdBy: userId, title: 'a' });
    await drainHooks();
    // Mutate the content_text directly, leaving the embedding row's hash
    // stale — exactly the case the reindex CLI exists to fix.
    await db.execute(rawSql`UPDATE pages SET content_text = 'mutated' WHERE id = ${p.id}::uuid`);
    const summary = await reindexEmbeddings(db, { workspaceId });
    expect(summary.processed).toBe(1);
    expect(summary.embedded).toBe(1);
  });

  it('processes only the requested workspace when workspaceId is given', async () => {
    await createPage(db, { workspaceId, createdBy: userId, title: 'mine' });
    const other = await createTestWorkspaceWithUser(db);
    await createPage(db, {
      workspaceId: other.workspaceId,
      createdBy: other.userId,
      title: 'theirs',
    });
    await drainHooks();
    // Wipe both so reindex(workspaceId) has work to do but ONLY for the
    // first workspace.
    await db.delete(schema.pageEmbeddings);

    const summary = await reindexEmbeddings(db, { workspaceId });
    expect(summary.processed).toBe(1);
    expect(summary.embedded).toBe(1);
    const rowsOther =
      (await sql`select count(*)::int as c from page_embeddings where workspace_id = ${other.workspaceId}`) as unknown as {
        c: number;
      }[];
    expect(rowsOther[0]?.c).toBe(0);
  });
});
