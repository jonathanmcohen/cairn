import { eq, sql as rawSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { __resetEmbeddingProviderForTests } from '@/lib/search/embed';
import { embedPage } from '@/lib/search/embed-page';
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

describe('embedPage', () => {
  let workspaceId: string;
  let pageId: string;

  beforeEach(async () => {
    await sql`TRUNCATE page_embeddings, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
    const u = await createTestWorkspaceWithUser(db);
    workspaceId = u.workspaceId;
    const p = await createPage(db, { workspaceId, createdBy: u.userId, title: 'P' });
    pageId = p.id;
    // Set content_text directly so the hash is deterministic and the
    // trigger-derived tsvector path doesn't matter for these assertions.
    await db
      .update(schema.pages)
      .set({ contentText: 'hello world' })
      .where(eq(schema.pages.id, pageId));
    delete process.env.CAIRN_EMBEDDING_URL;
    __resetEmbeddingProviderForTests();
    // Stub the local provider via a remote one — the test envs override the
    // factory so we avoid the 80MB Xenova download on every CI run.
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

  it('inserts a new embedding row when none exists and returns status=embedded', async () => {
    const result = await embedPage(db, pageId);
    expect(result.status).toBe('embedded');
    const [row] = await db
      .select()
      .from(schema.pageEmbeddings)
      .where(eq(schema.pageEmbeddings.pageId, pageId));
    expect(row).toBeTruthy();
    expect(row?.workspaceId).toBe(workspaceId);
    expect(row?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.embedding.length).toBe(384);
  });

  it('skips re-embedding when content_hash matches', async () => {
    await embedPage(db, pageId);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    const result = await embedPage(db, pageId);
    expect(result.status).toBe('skipped');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('re-embeds when content_text changes', async () => {
    await embedPage(db, pageId);
    const [before] = await db
      .select({ hash: schema.pageEmbeddings.contentHash })
      .from(schema.pageEmbeddings)
      .where(eq(schema.pageEmbeddings.pageId, pageId));
    await db
      .update(schema.pages)
      .set({ contentText: 'goodbye world' })
      .where(eq(schema.pages.id, pageId));
    const result = await embedPage(db, pageId);
    expect(result.status).toBe('embedded');
    const [after] = await db
      .select({ hash: schema.pageEmbeddings.contentHash })
      .from(schema.pageEmbeddings)
      .where(eq(schema.pageEmbeddings.pageId, pageId));
    expect(after?.hash).not.toBe(before?.hash);
  });

  it('treats null/empty content as empty string (does not throw)', async () => {
    await db.execute(rawSql`UPDATE pages SET content_text = '' WHERE id = ${pageId}::uuid`);
    const result = await embedPage(db, pageId);
    expect(result.status).toBe('embedded');
    const second = await embedPage(db, pageId);
    expect(second.status).toBe('skipped');
  });

  it('returns status=missing when the page does not exist', async () => {
    const result = await embedPage(db, '00000000-0000-0000-0000-000000000000');
    expect(result.status).toBe('missing');
  });
});
