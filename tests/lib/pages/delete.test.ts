import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
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

describe('softDeletePage', () => {
  it('marks the page and its descendants as deleted', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const root = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'Root',
    });
    const child = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: root.id,
      title: 'Child',
    });
    const grand = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      parentId: child.id,
      title: 'Grand',
    });

    await softDeletePage(db, {
      pageId: root.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      adminOverride: true,
    });

    const rows = await db.select().from(schema.pages);
    for (const r of rows) {
      expect(r.deletedAt).not.toBeNull();
    }
    const rootRow = rows.find((r) => r.id === root.id);
    const childRow = rows.find((r) => r.id === child.id);
    const grandRow = rows.find((r) => r.id === grand.id);
    expect(rootRow?.deletedRoot).toBe(true);
    expect(childRow?.deletedRoot).toBe(false);
    expect(grandRow?.deletedRoot).toBe(false);
  });

  it('does not touch sibling subtrees', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'A' });
    const b = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'B' });
    await softDeletePage(db, {
      pageId: a.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      adminOverride: true,
    });
    const [bRow] = await db.select().from(schema.pages).where(eq(schema.pages.id, b.id));
    expect(bRow?.deletedAt).toBeNull();
  });

  it('throws if the page is in another workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    await expect(
      softDeletePage(db, {
        pageId: p.id,
        workspaceId: a.workspaceId,
        actorUserId: a.userId,
        adminOverride: true,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
