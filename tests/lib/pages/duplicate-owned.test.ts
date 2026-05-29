import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { duplicateOwnedPage } from '@/lib/pages/duplicate-owned';
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

async function tree(workspaceId: string, userId: string) {
  const [root] = await db
    .insert(schema.pages)
    .values({
      workspaceId,
      title: 'Root',
      icon: '📦',
      cover: { type: 'color', value: 'blue' },
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      createdBy: userId,
    })
    .returning();
  const [child] = await db
    .insert(schema.pages)
    .values({ workspaceId, parentId: root!.id, title: 'Child', createdBy: userId })
    .returning();
  return { root: root!, child: child! };
}

describe('duplicateOwnedPage', () => {
  it('deep-copies a 2-page subtree in the same workspace with remapped parents + "Copy of" root', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    const { root, child } = await tree(ws.workspaceId, ws.userId);

    const newRootId = await duplicateOwnedPage(db, {
      sourcePageId: root.id,
      workspaceId: ws.workspaceId,
      actorUserId: ws.userId,
    });

    const [copiedRoot] = await db.select().from(schema.pages).where(eq(schema.pages.id, newRootId));
    expect(copiedRoot?.workspaceId).toBe(ws.workspaceId);
    expect(copiedRoot?.title).toBe('Copy of Root');
    expect(copiedRoot?.icon).toBe('📦');
    expect(copiedRoot?.id).not.toBe(root.id);
    // The copied root keeps the source's parent_id (sibling of the original).
    expect(copiedRoot?.parentId).toBe(root.parentId);
    expect(copiedRoot?.published).toBe(false);

    const copiedChildren = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.parentId, newRootId));
    expect(copiedChildren).toHaveLength(1);
    expect(copiedChildren[0]?.title).toBe('Child');
    expect(copiedChildren[0]?.id).not.toBe(child.id);
  });

  it('copies content jsonb verbatim', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    };
    const [src] = await db
      .insert(schema.pages)
      .values({ workspaceId: ws.workspaceId, title: 'Doc', content: doc, createdBy: ws.userId })
      .returning();

    const newRootId = await duplicateOwnedPage(db, {
      sourcePageId: src!.id,
      workspaceId: ws.workspaceId,
      actorUserId: ws.userId,
    });
    const [copied] = await db.select().from(schema.pages).where(eq(schema.pages.id, newRootId));
    expect(copied?.content).toEqual(doc);
  });

  it('refuses to duplicate an encrypted page', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    const [src] = await db
      .insert(schema.pages)
      .values({
        workspaceId: ws.workspaceId,
        title: 'Secret',
        encrypted: true,
        createdBy: ws.userId,
      })
      .returning();
    await expect(
      duplicateOwnedPage(db, {
        sourcePageId: src!.id,
        workspaceId: ws.workspaceId,
        actorUserId: ws.userId,
      }),
    ).rejects.toThrow();
  });

  it('refuses to duplicate a soft-deleted page', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    const [src] = await db
      .insert(schema.pages)
      .values({
        workspaceId: ws.workspaceId,
        title: 'Trashed',
        deletedAt: new Date(),
        createdBy: ws.userId,
      })
      .returning();
    await expect(
      duplicateOwnedPage(db, {
        sourcePageId: src!.id,
        workspaceId: ws.workspaceId,
        actorUserId: ws.userId,
      }),
    ).rejects.toThrow();
  });

  it('refuses a page in a different workspace', async () => {
    const ws = await createTestWorkspaceWithUser(db);
    const other = await createTestWorkspaceWithUser(db);
    const { root } = await tree(other.workspaceId, other.userId);
    await expect(
      duplicateOwnedPage(db, {
        sourcePageId: root.id,
        workspaceId: ws.workspaceId,
        actorUserId: ws.userId,
      }),
    ).rejects.toThrow();
  });
});
