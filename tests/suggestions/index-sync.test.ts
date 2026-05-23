import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import {
  acceptSuggestion,
  listOpenSuggestions,
  proposeSuggestion,
  rejectSuggestion,
} from '@/lib/suggestions/index-sync';
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
beforeEach(async () => {
  await sql`TRUNCATE suggestions, comments, files, db_cells, db_rows, db_properties, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function seed() {
  const u = await createTestWorkspaceWithUser(db);
  const page = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
  // Ensure a valid (suggestion-free) doc so accept/reject transforms are a no-op.
  await db
    .update(schema.pages)
    .set({ content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    .where(eq(schema.pages.id, page.id));
  return { workspaceId: u.workspaceId, userId: u.userId, pageId: page.id };
}

describe('index-sync', () => {
  it('propose inserts an open row and returns its id', async () => {
    const { pageId, userId } = await seed();
    const id = await proposeSuggestion(db, { pageId, authorId: userId });
    expect(typeof id).toBe('string');
    const [row] = await db.select().from(schema.suggestions).where(eq(schema.suggestions.id, id));
    expect(row?.status).toBe('open');
    expect(row?.authorId).toBe(userId);
    expect(row?.pageId).toBe(pageId);
  });

  it('listOpenSuggestions returns only open rows for the page', async () => {
    const { pageId, userId } = await seed();
    const a = await proposeSuggestion(db, { pageId, authorId: userId });
    await proposeSuggestion(db, { pageId, authorId: userId });
    await acceptSuggestion(db, { pageId, suggestionId: a, resolverId: userId });
    const open = await listOpenSuggestions(db, pageId);
    expect(open).toHaveLength(1);
    expect(open[0]?.status).toBe('open');
  });

  it('accept flips status to accepted and stamps resolvedBy + resolvedAt', async () => {
    const { pageId, userId } = await seed();
    const id = await proposeSuggestion(db, { pageId, authorId: userId });
    const res = await acceptSuggestion(db, { pageId, suggestionId: id, resolverId: userId });
    expect(res.resolved).toBe(true);
    const [row] = await db.select().from(schema.suggestions).where(eq(schema.suggestions.id, id));
    expect(row?.status).toBe('accepted');
    expect(row?.resolvedBy).toBe(userId);
    expect(row?.resolvedAt).not.toBeNull();
  });

  it('concurrent resolve: accept wins, a later reject of the same id is a no-op', async () => {
    const { pageId, userId } = await seed();
    const id = await proposeSuggestion(db, { pageId, authorId: userId });
    const first = await acceptSuggestion(db, { pageId, suggestionId: id, resolverId: userId });
    const second = await rejectSuggestion(db, { pageId, suggestionId: id, resolverId: userId });
    expect(first.resolved).toBe(true);
    expect(second.resolved).toBe(false);
    const [row] = await db.select().from(schema.suggestions).where(eq(schema.suggestions.id, id));
    expect(row?.status).toBe('accepted');
  });
});
