import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
import { hardDeletePage } from '@/lib/pages/trash';
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

describe('hardDeletePage', () => {
  it('permanently removes the page and its descendants', async () => {
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
    await hardDeletePage(db, { pageId: root.id, workspaceId: u.workspaceId });
    const rows = await db.select().from(schema.pages);
    expect(rows).toEqual([]);
  });

  it('only operates on trash entries (refuses live pages)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    await expect(hardDeletePage(db, { pageId: p.id, workspaceId: u.workspaceId })).rejects.toThrow(
      /not in trash/i,
    );
  });

  it('rejects cross-workspace deletes', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: b.workspaceId, createdBy: b.userId });
    await softDeletePage(db, {
      pageId: p.id,
      workspaceId: b.workspaceId,
      actorUserId: b.userId,
    });
    await expect(hardDeletePage(db, { pageId: p.id, workspaceId: a.workspaceId })).rejects.toThrow(
      /not in trash/i,
    );
  });
});
