import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { flattenedPageTree, getPageTree } from '@/lib/pages/tree';
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

describe('getPageTree', () => {
  it('returns an empty array when no pages exist', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const tree = await getPageTree(db, u.workspaceId);
    expect(tree).toEqual([]);
  });

  it('returns a flat list of top-level pages with empty children', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    const tree = await getPageTree(db, u.workspaceId);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it('nests children under parents', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Root',
    });
    await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'C1',
    });
    await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'C2',
    });
    const tree = await getPageTree(db, u.workspaceId);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toHaveLength(2);
    expect(tree[0]?.children.map((c) => c.title).sort()).toEqual(['C1', 'C2']);
  });

  it('excludes soft-deleted pages', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'V' });
    await sql`UPDATE pages SET deleted_at = now() WHERE id = ${p.id}`;
    const tree = await getPageTree(db, u.workspaceId);
    expect(tree).toEqual([]);
  });
});

describe('flattenedPageTree', () => {
  it('returns a depth-first, sibling-by-createdAt flat list with correct depths', async () => {
    const u = await createTestWorkspaceWithUser(db);
    // Insert with small delays so createdAt ordering is deterministic
    // (Postgres timestamp resolution at microsecond level).
    const root1 = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'A',
    });
    await new Promise((r) => setTimeout(r, 5));
    const a1 = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root1.id,
      title: 'A.1',
    });
    await new Promise((r) => setTimeout(r, 5));
    const a1a = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: a1.id,
      title: 'A.1.a',
    });
    await new Promise((r) => setTimeout(r, 5));
    const a2 = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root1.id,
      title: 'A.2',
    });
    await new Promise((r) => setTimeout(r, 5));
    const root2 = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'B',
    });

    const flat = await flattenedPageTree(db, u.workspaceId);
    expect(flat.map((n) => n.title)).toEqual(['A', 'A.1', 'A.1.a', 'A.2', 'B']);
    expect(flat.map((n) => n.depth)).toEqual([0, 1, 2, 1, 0]);
    expect(flat[0]?.parentId).toBe(null);
    expect(flat[1]?.parentId).toBe(root1.id);
    expect(flat[2]?.parentId).toBe(a1.id);
    expect(flat[3]?.parentId).toBe(root1.id);
    expect(flat[4]?.parentId).toBe(null);
    // Sanity: the nested shape continues to work (no regression on getPageTree).
    const nested = await getPageTree(db, u.workspaceId);
    expect(nested.map((n) => n.title)).toEqual(['A', 'B']);
    expect(nested[0]?.children[0]?.children[0]?.title).toBe('A.1.a');
    expect(a2.id).toBeTruthy();
    expect(root2.id).toBeTruthy();
  });

  it('returns an empty array for a workspace with no pages', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const flat = await flattenedPageTree(db, u.workspaceId);
    expect(flat).toEqual([]);
  });

  it('promotes orphans (parent soft-deleted) to roots', async () => {
    const u = await createTestWorkspaceWithUser(db);
    // Simulate an orphan whose parent has been soft-deleted: the parent row
    // still exists (FK satisfied) but is filtered out by the deletedAt
    // predicate, so flattenedPageTree never sees it.
    const parent = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'parent',
    });
    const orphan = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: parent.id,
      title: 'orphan',
    });
    await sql`UPDATE pages SET deleted_at = now() WHERE id = ${parent.id}`;

    const flat = await flattenedPageTree(db, u.workspaceId);
    expect(flat).toHaveLength(1);
    expect(flat[0]?.title).toBe('orphan');
    expect(flat[0]?.depth).toBe(0);
    expect(orphan?.id).toBeTruthy();
  });
});
