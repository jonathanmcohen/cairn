import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { __resetEmbeddingProviderForTests } from '@/lib/search/embed';
import { runEmbedPageCli } from '@/server/embed-page-cli';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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

describe('runEmbedPageCli', () => {
  let pageId: string;

  beforeEach(async () => {
    await sql`TRUNCATE page_embeddings, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'P' });
    pageId = p.id;
    await db
      .update(schema.pages)
      .set({ contentText: 'hello smoke world' })
      .where(eq(schema.pages.id, pageId));
    // Inject a deterministic remote provider so the unit test never downloads a
    // model — the CI smoke job exercises the real WASM path; this proves the
    // CLI plumbing (resolve page id -> embedPage -> page_embeddings row).
    delete process.env.CAIRN_EMBEDDING_URL;
    __resetEmbeddingProviderForTests();
    process.env.CAIRN_EMBEDDING_URL = 'http://stub.local/v1/embeddings';
    __resetEmbeddingProviderForTests();
    const fakeVec = Array.from({ length: 384 }, () => 0.01);
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ embedding: fakeVec }] }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  it('embeds a seeded page and writes a page_embeddings row', async () => {
    const result = await runEmbedPageCli(db, [pageId]);
    expect(result.status).toBe('embedded');
    const rows = await db
      .select()
      .from(schema.pageEmbeddings)
      .where(eq(schema.pageEmbeddings.pageId, pageId));
    expect(rows.length).toBe(1);
  });

  it('exits with status missing for an unknown page id', async () => {
    const result = await runEmbedPageCli(db, ['00000000-0000-0000-0000-000000000000']);
    expect(result.status).toBe('missing');
  });

  it('throws when no page id is supplied', async () => {
    await expect(runEmbedPageCli(db, [])).rejects.toThrow(/usage/);
  });
});
