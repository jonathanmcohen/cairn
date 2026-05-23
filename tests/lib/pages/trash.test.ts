import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
import { listTrash } from '@/lib/pages/trash';
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

describe('listTrash', () => {
  it('returns only deleted_root pages for the workspace', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'R',
    });
    await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'C',
    });
    await softDeletePage(db, {
      pageId: root.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    const trash = await listTrash(db, u.workspaceId);
    expect(trash).toHaveLength(1);
    expect(trash[0]?.title).toBe('R');
  });

  it('returns nothing when no pages are deleted', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'L' });
    const trash = await listTrash(db, u.workspaceId);
    expect(trash).toEqual([]);
  });

  it('orders by deleted_at desc', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    await softDeletePage(db, {
      pageId: a.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    await new Promise((r) => setTimeout(r, 30));
    await softDeletePage(db, {
      pageId: b.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    const trash = await listTrash(db, u.workspaceId);
    expect(trash.map((t) => t.title)).toEqual(['B', 'A']);
  });

  it('excludes other workspaces', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId, title: 'B' });
    await softDeletePage(db, {
      pageId: p.id,
      workspaceId: b.workspaceId,
      actorUserId: b.userId,
    });
    const trash = await listTrash(db, a.workspaceId);
    expect(trash).toEqual([]);
  });
});
