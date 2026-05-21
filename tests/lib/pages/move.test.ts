import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { movePage } from '@/lib/pages/move';
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

describe('movePage', () => {
  it('reparents a page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    await movePage(db, { pageId: b.id, workspaceId: u.workspaceId, newParentId: a.id });
    const [moved] = await db.select().from(schema.pages).where(eq(schema.pages.id, b.id));
    expect(moved?.parentId).toBe(a.id);
  });

  it('moves a page to top-level when newParentId is null', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: a.id,
      title: 'B',
    });
    await movePage(db, { pageId: b.id, workspaceId: u.workspaceId, newParentId: null });
    const [moved] = await db.select().from(schema.pages).where(eq(schema.pages.id, b.id));
    expect(moved?.parentId).toBeNull();
  });

  it('rejects a cyclic move (parent under its own descendant)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: a.id,
      title: 'B',
    });
    await expect(
      movePage(db, { pageId: a.id, workspaceId: u.workspaceId, newParentId: b.id }),
    ).rejects.toThrow(/cycle/i);
  });

  it('rejects moving to a parent in a different workspace', async () => {
    const x = await createTestWorkspaceWithUser(db);
    const y = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: x.workspaceId, createdBy: x.userId });
    const foreign = await createPage(db, { workspaceId: y.workspaceId, createdBy: y.userId });
    await expect(
      movePage(db, { pageId: p.id, workspaceId: x.workspaceId, newParentId: foreign.id }),
    ).rejects.toThrow(/workspace/i);
  });

  it('rejects moving a page under itself', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await expect(
      movePage(db, { pageId: p.id, workspaceId: u.workspaceId, newParentId: p.id }),
    ).rejects.toThrow(/cycle|self/i);
  });
});
