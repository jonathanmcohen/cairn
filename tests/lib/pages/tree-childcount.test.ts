import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { movePage } from '@/lib/pages/move';
import { POSITION_GAP } from '@/lib/pages/position';
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

async function positionOf(pageId: string): Promise<number> {
  const [row] = await db
    .select({ position: schema.pages.position })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId));
  if (!row) throw new Error(`page ${pageId} not found`);
  return row.position;
}

describe('flattenedPageTree childCount (v0.10.2 S8)', () => {
  it('annotates each node with its direct visible child count', async () => {
    const u = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const root = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Root',
    });
    const mid = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'Mid',
    });
    await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'Leaf sibling',
    });
    await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: mid.id,
      title: 'Grandchild',
    });

    const flat = await flattenedPageTree(db, u.workspaceId);
    const byTitle = new Map(flat.map((n) => [n.title, n]));
    expect(byTitle.get('Root')?.childCount).toBe(2);
    expect(byTitle.get('Mid')?.childCount).toBe(1);
    expect(byTitle.get('Leaf sibling')?.childCount).toBe(0);
    expect(byTitle.get('Grandchild')?.childCount).toBe(0);
  });

  it('counts only DIRECT children (not the whole subtree)', async () => {
    const u = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const root = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Root',
    });
    const a = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'A',
    });
    await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: a.id,
      title: 'A.1',
    });
    const flat = await flattenedPageTree(db, u.workspaceId);
    expect(flat.find((n) => n.title === 'Root')?.childCount).toBe(1);
  });
});

describe('sibling ordering by position (v0.10.2 S8)', () => {
  it('createPage gap-numbers new pages last among their siblings', async () => {
    const u = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    expect(await positionOf(a.id)).toBe(POSITION_GAP);
    expect(await positionOf(b.id)).toBe(POSITION_GAP * 2);
    const flat = await flattenedPageTree(db, u.workspaceId);
    expect(flat.map((n) => n.title)).toEqual(['A', 'B']);
  });

  it('flattenedPageTree orders siblings by position, not createdAt', async () => {
    const u = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    // Swap the explicit positions; createdAt still says A-then-B.
    await db.update(schema.pages).set({ position: 1 }).where(eq(schema.pages.id, b.id));
    await db.update(schema.pages).set({ position: 2 }).where(eq(schema.pages.id, a.id));
    const flat = await flattenedPageTree(db, u.workspaceId);
    expect(flat.map((n) => n.title)).toEqual(['B', 'A']);
  });

  it('movePage with beforeId bisects the gap before the anchor (midpoint)', async () => {
    const u = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    const c = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'C' });
    // Move C between A (1024) and B (2048): afterId=A → midpoint 1536.
    await movePage(db, {
      pageId: c.id,
      workspaceId: u.workspaceId,
      newParentId: null,
      afterId: a.id,
      byUserId: u.userId,
      adminOverride: true,
    });
    expect(await positionOf(c.id)).toBe(POSITION_GAP + POSITION_GAP / 2);
    let flat = await flattenedPageTree(db, u.workspaceId);
    expect(flat.map((n) => n.title)).toEqual(['A', 'C', 'B']);
    // Move B before A: head insert → floor(1024 / 2) = 512.
    await movePage(db, {
      pageId: b.id,
      workspaceId: u.workspaceId,
      newParentId: null,
      beforeId: a.id,
      byUserId: u.userId,
      adminOverride: true,
    });
    expect(await positionOf(b.id)).toBe(POSITION_GAP / 2);
    flat = await flattenedPageTree(db, u.workspaceId);
    expect(flat.map((n) => n.title)).toEqual(['B', 'A', 'C']);
  });

  it('renumbers the sibling group (*1024) when the midpoint gap closes', async () => {
    const u = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    const c = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'C' });
    // Close the A↔B gap completely: adjacent integers leave no midpoint.
    await db.update(schema.pages).set({ position: 1 }).where(eq(schema.pages.id, a.id));
    await db.update(schema.pages).set({ position: 2 }).where(eq(schema.pages.id, b.id));
    await movePage(db, {
      pageId: c.id,
      workspaceId: u.workspaceId,
      newParentId: null,
      beforeId: b.id,
      byUserId: u.userId,
      adminOverride: true,
    });
    // Renumber path: A/B/C → 1024/2048/3072, then C lands at midpoint(A, B).
    expect(await positionOf(a.id)).toBe(POSITION_GAP);
    expect(await positionOf(b.id)).toBe(POSITION_GAP * 2);
    expect(await positionOf(c.id)).toBe(POSITION_GAP + POSITION_GAP / 2);
    const flat = await flattenedPageTree(db, u.workspaceId);
    expect(flat.map((n) => n.title)).toEqual(['A', 'C', 'B']);
  });

  it('movePage WITHOUT an anchor reparents + appends at the end of the group', async () => {
    const u = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const parent = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Parent',
    });
    const x = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: parent.id,
      title: 'X',
    });
    const moved = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Moved',
    });
    await movePage(db, {
      pageId: moved.id,
      workspaceId: u.workspaceId,
      newParentId: parent.id,
      byUserId: u.userId,
      adminOverride: true,
    });
    expect(await positionOf(moved.id)).toBe((await positionOf(x.id)) + POSITION_GAP);
    const flat = await flattenedPageTree(db, u.workspaceId);
    expect(flat.map((n) => n.title)).toEqual(['Parent', 'X', 'Moved']);
  });

  it('rejects an anchor that is not a sibling under the new parent', async () => {
    const u = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: a.id,
      title: 'B',
    });
    const c = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'C' });
    await expect(
      movePage(db, {
        pageId: c.id,
        workspaceId: u.workspaceId,
        newParentId: null,
        // B is a child of A, not a root sibling.
        beforeId: b.id,
        byUserId: u.userId,
        adminOverride: true,
      }),
    ).rejects.toThrow(/sibling/i);
  });

  it('rejects passing both beforeId and afterId', async () => {
    const u = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    const c = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'C' });
    await expect(
      movePage(db, {
        pageId: c.id,
        workspaceId: u.workspaceId,
        newParentId: null,
        beforeId: a.id,
        afterId: b.id,
        byUserId: u.userId,
        adminOverride: true,
      }),
    ).rejects.toThrow(/at most one/i);
  });
});
