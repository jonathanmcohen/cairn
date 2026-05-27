import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { flattenedPageTree } from '@/lib/pages/tree';
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
  createdBy: string,
  title: string,
  status: schema.PageStatus,
): Promise<string> {
  const p = await createPage(db, { workspaceId, createdBy, title });
  await sql`UPDATE pages SET status = ${status} WHERE id = ${p.id}`;
  return p.id;
}

describe('flattenedPageTree — v0.9.0 G4 P26 status visibility', () => {
  it('hides archived pages from every viewer', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const pubId = await makePage(u.workspaceId, u.userId, 'Pub', 'published');
    await makePage(u.workspaceId, u.userId, 'Arc', 'archived');
    const tree = await flattenedPageTree(db, u.workspaceId, u.userId);
    expect(tree.map((r) => r.id)).toEqual([pubId]);
  });

  it('hides draft pages from non-author viewers', async () => {
    const author = await createTestWorkspaceWithUser(db);
    // A second user inside the same workspace.
    const [other] = await db
      .insert(schema.users)
      .values({ email: `o-${Date.now()}@example.com`, name: 'O', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    const pubId = await makePage(author.workspaceId, author.userId, 'Pub', 'published');
    await makePage(author.workspaceId, author.userId, 'Draft', 'draft');
    const tree = await flattenedPageTree(db, author.workspaceId, other!.id);
    expect(tree.map((r) => r.id)).toEqual([pubId]);
  });

  it('shows draft pages to their author', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const pubId = await makePage(u.workspaceId, u.userId, 'Pub', 'published');
    const draftId = await makePage(u.workspaceId, u.userId, 'Draft', 'draft');
    const tree = await flattenedPageTree(db, u.workspaceId, u.userId);
    expect(tree.map((r) => r.id).sort()).toEqual([pubId, draftId].sort());
  });

  it('always shows review status', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const reviewId = await makePage(u.workspaceId, u.userId, 'Review', 'review');
    const tree = await flattenedPageTree(db, u.workspaceId, u.userId);
    expect(tree.map((r) => r.id)).toContain(reviewId);
  });

  it('without a viewerUserId, hides every draft + archived', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const pubId = await makePage(u.workspaceId, u.userId, 'Pub', 'published');
    await makePage(u.workspaceId, u.userId, 'Draft', 'draft');
    await makePage(u.workspaceId, u.userId, 'Arc', 'archived');
    const tree = await flattenedPageTree(db, u.workspaceId);
    expect(tree.map((r) => r.id)).toEqual([pubId]);
  });
});
