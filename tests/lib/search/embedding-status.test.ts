import { eq, sql as rawSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { computeContentHash } from '@/lib/search/embed-page';
import { countPendingEmbeddings } from '@/lib/search/embedding-status';
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

/**
 * Insert a page directly (no createPage → no on-write embed hook; the
 * pages_search_sync_trigger still derives content_text from `content`).
 * Returns the id plus the trigger-derived content_text read back from the db.
 */
async function insertPage(
  workspaceId: string,
  createdBy: string,
  opts: { deletedAt?: Date; encrypted?: boolean } = {},
): Promise<{ id: string; contentText: string }> {
  const [row] = await db
    .insert(schema.pages)
    .values({
      workspaceId,
      createdBy,
      title: 'p',
      ...(opts.deletedAt ? { deletedAt: opts.deletedAt } : {}),
      ...(opts.encrypted ? { encrypted: true } : {}),
    })
    .returning({ id: schema.pages.id });
  if (!row) throw new Error('insert failed');
  const [page] = await db
    .select({ contentText: schema.pages.contentText })
    .from(schema.pages)
    .where(eq(schema.pages.id, row.id));
  return { id: row.id, contentText: page?.contentText ?? '' };
}

/** Insert a page_embeddings row whose content_hash matches the given text. */
async function insertEmbedding(pageId: string, workspaceId: string, text: string): Promise<void> {
  await db.insert(schema.pageEmbeddings).values({
    pageId,
    workspaceId,
    embedding: Array.from({ length: 384 }, () => 0.1),
    contentHash: computeContentHash(text),
  });
}

describe('countPendingEmbeddings', () => {
  let workspaceId: string;
  let userId: string;

  beforeEach(async () => {
    await sql`TRUNCATE page_embeddings, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
    const u = await createTestWorkspaceWithUser(db);
    workspaceId = u.workspaceId;
    userId = u.userId;
  });

  it('counts a page with no page_embeddings row', async () => {
    await insertPage(workspaceId, userId);
    expect(await countPendingEmbeddings(db, workspaceId)).toBe(1);
  });

  it('does not count a page whose embedding hash matches the current content', async () => {
    const p = await insertPage(workspaceId, userId);
    await insertEmbedding(p.id, workspaceId, p.contentText);
    expect(await countPendingEmbeddings(db, workspaceId)).toBe(0);
  });

  it('counts a page whose content changed after embedding (stale hash)', async () => {
    const p = await insertPage(workspaceId, userId);
    await insertEmbedding(p.id, workspaceId, p.contentText);
    // Mutate content_text directly — the search-sync trigger only fires on
    // title/content updates, so the stored embedding hash goes stale exactly
    // as it does between a page write and its setImmediate embed hook.
    await db.execute(rawSql`UPDATE pages SET content_text = 'mutated' WHERE id = ${p.id}::uuid`);
    expect(await countPendingEmbeddings(db, workspaceId)).toBe(1);
  });

  it('does not count a soft-deleted page', async () => {
    await insertPage(workspaceId, userId, { deletedAt: new Date() });
    expect(await countPendingEmbeddings(db, workspaceId)).toBe(0);
  });

  it('does not count an encrypted page (never indexable, not "still indexing")', async () => {
    await insertPage(workspaceId, userId, { encrypted: true });
    expect(await countPendingEmbeddings(db, workspaceId)).toBe(0);
  });

  it('scopes the count to the requested workspace', async () => {
    const other = await createTestWorkspaceWithUser(db);
    await insertPage(other.workspaceId, other.userId);
    expect(await countPendingEmbeddings(db, workspaceId)).toBe(0);
    expect(await countPendingEmbeddings(db, other.workspaceId)).toBe(1);
  });
});
