import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
import { restorePage } from '@/lib/pages/trash';
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

describe('restorePage', () => {
  it('clears deleted_at on root and all cascaded descendants', async () => {
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
    await softDeletePage(db, { pageId: root.id, workspaceId: u.workspaceId });
    await restorePage(db, { pageId: root.id, workspaceId: u.workspaceId });
    const rows = await db.select().from(schema.pages);
    for (const r of rows) {
      expect(r.deletedAt).toBeNull();
      expect(r.deletedRoot).toBe(false);
    }
    expect(rows).toHaveLength(2);
  });

  it('throws if the page is not in the trash (not deleted_root)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await expect(restorePage(db, { pageId: p.id, workspaceId: u.workspaceId })).rejects.toThrow(
      /not in trash/i,
    );
  });

  it('does not restore unrelated deleted_root pages', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    await softDeletePage(db, { pageId: a.id, workspaceId: u.workspaceId });
    await softDeletePage(db, { pageId: b.id, workspaceId: u.workspaceId });
    await restorePage(db, { pageId: a.id, workspaceId: u.workspaceId });
    const [bRow] = await db.select().from(schema.pages).where(eq(schema.pages.id, b.id));
    expect(bRow?.deletedAt).not.toBeNull();
    expect(bRow?.deletedRoot).toBe(true);
  });

  it('rejects pages in another workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    await softDeletePage(db, { pageId: p.id, workspaceId: b.workspaceId });
    await expect(restorePage(db, { pageId: p.id, workspaceId: a.workspaceId })).rejects.toThrow(
      /not in trash/i,
    );
  });
});
