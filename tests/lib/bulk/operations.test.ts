import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { bulkRestorePages, bulkTrashPages } from '@/lib/bulk/operations';
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

async function makePages(workspaceId: string, createdBy: string, n: number): Promise<string[]> {
  const rows = await db
    .insert(schema.pages)
    .values(Array.from({ length: n }, (_, i) => ({ workspaceId, title: `p${i}`, createdBy })))
    .returning({ id: schema.pages.id });
  return rows.map((r) => r.id);
}

describe('bulk operations', () => {
  it('bulk-trashes all selected pages and reports them succeeded', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const ids = await makePages(a.workspaceId, a.userId, 3);
    const res = await bulkTrashPages(db, {
      workspaceId: a.workspaceId,
      userId: a.userId,
      role: 'editor',
      ids,
    });
    expect(res.succeeded.sort()).toEqual([...ids].sort());
    expect(res.failed).toHaveLength(0);
    const left = await db.select().from(schema.pages).where(inArray(schema.pages.id, ids));
    expect(left.every((p) => p.deletedAt !== null)).toBe(true);
  });

  it('reports a partial failure for an id outside the workspace without aborting the rest', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const ids = await makePages(a.workspaceId, a.userId, 2);
    const bogus = '00000000-0000-0000-0000-0000000000ff';
    const res = await bulkTrashPages(db, {
      workspaceId: a.workspaceId,
      userId: a.userId,
      role: 'editor',
      ids: [...ids, bogus],
    });
    expect(res.succeeded.sort()).toEqual([...ids].sort());
    expect(res.failed.map((f) => f.id)).toEqual([bogus]);
  });

  it('bulk-restores trashed pages', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'editor' });
    const ids = await makePages(a.workspaceId, a.userId, 2);
    await bulkTrashPages(db, { workspaceId: a.workspaceId, userId: a.userId, role: 'editor', ids });
    const res = await bulkRestorePages(db, {
      workspaceId: a.workspaceId,
      userId: a.userId,
      role: 'editor',
      ids,
    });
    expect(res.succeeded.sort()).toEqual([...ids].sort());
    const restored = await db.select().from(schema.pages).where(inArray(schema.pages.id, ids));
    expect(restored.every((p) => p.deletedAt === null)).toBe(true);
  });
});
