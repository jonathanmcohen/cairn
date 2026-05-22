import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createComment } from '@/lib/comments/create';
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
  await sql`TRUNCATE comments, notifications, files, db_cells, db_rows, db_properties, databases, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
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

describe('createComment (polymorphic targets)', () => {
  it('creates a page-level comment (back-compat) with denormalized page id', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId });
    const { comment: c } = await createComment(db, {
      workspaceId: u.workspaceId,
      authorId: u.userId,
      body: 'hello',
      target: { type: 'page', id: p.id },
    });
    expect(c.targetType).toBe('page');
    expect(c.targetId).toBe(p.id);
    expect(c.pageId).toBe(p.id);
  });

  it('creates a db_row comment with the owning database page denormalized', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { pageId, rowId } = await seedRow(u.workspaceId, u.userId);
    const { comment: c } = await createComment(db, {
      workspaceId: u.workspaceId,
      authorId: u.userId,
      body: 'on a row',
      target: { type: 'db_row', id: rowId },
    });
    expect(c.targetType).toBe('db_row');
    expect(c.targetId).toBe(rowId);
    expect(c.pageId).toBe(pageId);
  });

  it('creates a file comment with a null page id', async () => {
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
    const { comment: c } = await createComment(db, {
      workspaceId: u.workspaceId,
      authorId: u.userId,
      body: 'on a file',
      target: { type: 'file', id: f.id },
    });
    expect(c.targetType).toBe('file');
    expect(c.targetId).toBe(f.id);
    expect(c.pageId).toBeNull();
  });

  it('fans out mentions for a db_row comment', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { rowId } = await seedRow(u.workspaceId, u.userId);
    const [mentioned] = await db
      .insert(schema.users)
      .values({
        email: `bob-${crypto.randomUUID()}@example.com`,
        passwordHash: 'h',
        name: 'Bob',
      })
      .returning();
    if (!mentioned) throw new Error('mentioned user');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: u.workspaceId, userId: mentioned.id, role: 'editor' });

    const { mentionedUserIds } = await createComment(db, {
      workspaceId: u.workspaceId,
      authorId: u.userId,
      body: `hey @[Bob](${mentioned.id})`,
      target: { type: 'db_row', id: rowId },
    });

    if (mentionedUserIds.includes(mentioned.id)) {
      const notes = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, mentioned.id));
      expect(notes.length).toBeGreaterThan(0);
    }
    expect(mentionedUserIds).toContain(mentioned.id);
  });

  it('rejects a non-null anchor on a non-page target', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { rowId } = await seedRow(u.workspaceId, u.userId);
    await expect(
      createComment(db, {
        workspaceId: u.workspaceId,
        authorId: u.userId,
        body: 'x',
        target: { type: 'db_row', id: rowId },
        anchor: { blockId: 'blk-1' },
      }),
    ).rejects.toThrow();
  });

  it('rejects a cross-workspace target', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const other = await createTestWorkspaceWithUser(db);
    const { rowId } = await seedRow(other.workspaceId, other.userId);
    await expect(
      createComment(db, {
        workspaceId: u.workspaceId,
        authorId: u.userId,
        body: 'x',
        target: { type: 'db_row', id: rowId },
      }),
    ).rejects.toThrow();
  });
});
