import { sql as drizzleSql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { runOrphanPurge } from '@/lib/pages/orphan-purge';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, audit_log RESTART IDENTITY CASCADE`;
});

/** Force a page's created_at into the past so it clears the age threshold. */
async function agePage(pageId: string, daysAgo: number): Promise<void> {
  await db.execute(drizzleSql`
    UPDATE pages SET created_at = now() - (${daysAgo}::text || ' days')::interval
     WHERE id = ${pageId}
  `);
}

async function seedWs() {
  return createTestWorkspaceWithUser(db, { role: 'owner' });
}

describe('runOrphanPurge', () => {
  it('dry-run lists an aged orphan-empty-Untitled page without deleting it', async () => {
    const ws = await seedWs();
    const orphan = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await agePage(orphan.id, 60);

    const result = await runOrphanPurge(db, { olderThanDays: 30, dryRun: true });
    expect(result.purgedCount).toBe(0);
    expect(result.candidates.map((c) => c.pageId)).toEqual([orphan.id]);

    const [row] = (await db.execute(drizzleSql`
      SELECT deleted_at FROM pages WHERE id = ${orphan.id}
    `)) as unknown as Array<{ deleted_at: Date | null }>;
    expect(row?.deleted_at).toBeNull();
  });

  it('soft-deletes an aged orphan by default (sets deleted_at)', async () => {
    const ws = await seedWs();
    const orphan = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await agePage(orphan.id, 60);

    const result = await runOrphanPurge(db, { olderThanDays: 30, dryRun: false });
    expect(result.purgedCount).toBe(1);
    expect(result.candidates.map((c) => c.pageId)).toEqual([orphan.id]);

    const [row] = (await db.execute(drizzleSql`
      SELECT deleted_at FROM pages WHERE id = ${orphan.id}
    `)) as unknown as Array<{ deleted_at: Date | null }>;
    expect(row?.deleted_at).not.toBeNull();
  });

  it('excludes titled, non-empty, already-trashed, parent, and too-new pages', async () => {
    const ws = await seedWs();

    // (a) titled — not 'Untitled'
    const titled = await createPage(db, {
      workspaceId: ws.workspaceId,
      createdBy: ws.userId,
      title: 'Keep me',
    });
    await agePage(titled.id, 60);

    // (b) non-empty content_text
    const nonEmpty = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await db
      .update(schema.pages)
      .set({ contentText: 'words' })
      .where(eq(schema.pages.id, nonEmpty.id));
    await agePage(nonEmpty.id, 60);

    // (c) already trashed
    const trashed = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await db
      .update(schema.pages)
      .set({ deletedAt: new Date() })
      .where(eq(schema.pages.id, trashed.id));
    await agePage(trashed.id, 60);

    // (d) parent of a child — empty/Untitled but referenced via parent_id
    const parent = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });
    await createPage(db, {
      workspaceId: ws.workspaceId,
      createdBy: ws.userId,
      parentId: parent.id,
      title: 'child',
    });
    await agePage(parent.id, 60);

    // (e) too new — orphan-empty-Untitled but created today
    const tooNew = await createPage(db, { workspaceId: ws.workspaceId, createdBy: ws.userId });

    const result = await runOrphanPurge(db, { olderThanDays: 30, dryRun: true });
    const ids = result.candidates.map((c) => c.pageId);
    expect(ids).not.toContain(titled.id);
    expect(ids).not.toContain(nonEmpty.id);
    expect(ids).not.toContain(trashed.id);
    expect(ids).not.toContain(parent.id);
    expect(ids).not.toContain(tooNew.id);
    expect(ids).toHaveLength(0);
  });
});
