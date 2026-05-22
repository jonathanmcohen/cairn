import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { resolveTarget } from '@/lib/comments/target';
import { createPage } from '@/lib/pages/create';
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
  await sql`TRUNCATE comments, files, db_cells, db_rows, db_properties, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function seedRow(workspaceId: string, userId: string) {
  const p = await createPage(db, { workspaceId, createdBy: userId });
  const [d] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: p.id, createdBy: userId })
    .returning();
  if (!d) throw new Error('db');
  const [row] = await db
    .insert(schema.dbRows)
    .values({ databaseId: d.id, createdBy: userId })
    .returning();
  if (!row) throw new Error('row');
  return { pageId: p.id, rowId: row.id };
}

describe('resolveTarget', () => {
  it('resolves a page target to its own id', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const r = await resolveTarget(db, u.workspaceId, { type: 'page', id: p.id });
    expect(r.pageId).toBe(p.id);
  });

  it('resolves a db_row target to its owning database page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { pageId, rowId } = await seedRow(u.workspaceId, u.userId);
    const r = await resolveTarget(db, u.workspaceId, { type: 'db_row', id: rowId });
    expect(r.pageId).toBe(pageId);
  });

  it('resolves a file target (page_id may be null)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [f] = await db
      .insert(schema.files)
      .values({
        workspaceId: u.workspaceId,
        name: 'a',
        mimeType: 't',
        size: 1,
        path: '/p',
        uploadedBy: u.userId,
      })
      .returning();
    if (!f) throw new Error('file');
    const r = await resolveTarget(db, u.workspaceId, { type: 'file', id: f.id });
    expect(r.pageId).toBeNull();
  });

  it('throws 404 for a row in another workspace', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const other = await createTestWorkspaceWithUser(db);
    const { rowId } = await seedRow(other.workspaceId, other.userId);
    await expect(
      resolveTarget(db, u.workspaceId, { type: 'db_row', id: rowId }),
    ).rejects.toThrow();
  });

  it('throws 404 for a missing file id', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await expect(
      resolveTarget(db, u.workspaceId, { type: 'file', id: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toThrow();
  });
});
