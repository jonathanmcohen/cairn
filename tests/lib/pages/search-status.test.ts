import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { searchPages } from '@/lib/pages/search';
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

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makePage(
  workspaceId: string,
  userId: string,
  title: string,
  status: schema.PageStatus,
): Promise<string> {
  const p = await createPage(db, { workspaceId, createdBy: userId, title });
  // createPage doesn't accept status — set it directly. The FTS trigger
  // re-fires on this UPDATE so the tsvector picks up status changes
  // transparently.
  await sql`UPDATE pages SET status = ${status} WHERE id = ${p.id}`;
  return p.id;
}

describe('searchPages — v0.9.0 G4 P26 status filter', () => {
  it('excludes draft pages from results', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await makePage(u.workspaceId, u.userId, 'PublishedQuokka', 'published');
    await makePage(u.workspaceId, u.userId, 'DraftQuokka', 'draft');
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'PublishedQuokka' });
    expect(results.map((r) => r.title)).toContain('PublishedQuokka');
    expect(results.map((r) => r.title)).not.toContain('DraftQuokka');
    // Searching the draft title directly returns nothing.
    const draftResults = await searchPages(db, {
      workspaceId: u.workspaceId,
      query: 'DraftQuokka',
    });
    expect(draftResults.map((r) => r.title)).not.toContain('DraftQuokka');
  });

  it('excludes archived pages from results', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await makePage(u.workspaceId, u.userId, 'ArchivedHit', 'archived');
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'ArchivedHit' });
    expect(results).toHaveLength(0);
  });

  it('includes review status (gated UI, but search-discoverable for workspace members)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await makePage(u.workspaceId, u.userId, 'InReview', 'review');
    const results = await searchPages(db, { workspaceId: u.workspaceId, query: 'InReview' });
    expect(results.map((r) => r.title)).toContain('InReview');
  });
});
