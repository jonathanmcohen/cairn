import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { duplicatePublicPage } from '@/lib/pages/duplicate';
import { publishPage } from '@/lib/pages/publish';
import { setShareSettings } from '@/lib/pages/share';
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
      content: { type: 'doc', content: [] },
      createdBy: userId,
    })
    .returning();
  const [child] = await db
    .insert(schema.pages)
    .values({ workspaceId, parentId: root!.id, title: 'Child', createdBy: userId })
    .returning();
  return { root: root!, child: child! };
}

describe('duplicatePublicPage', () => {
  it('deep-copies the subtree into the target workspace with fresh ids + remapped parents', async () => {
    const src = await createTestWorkspaceWithUser(db);
    const dst = await createTestWorkspaceWithUser(db);
    const { root, child } = await tree(src.workspaceId, src.userId);
    await publishPage(db, {
      pageId: root.id,
      workspaceId: src.workspaceId,
      actorUserId: src.userId,
    });
    await setShareSettings(db, {
      pageId: root.id,
      workspaceId: src.workspaceId,
      actorUserId: src.userId,
      allowDuplication: true,
    });

    const newRootId = await duplicatePublicPage(db, {
      sourcePageId: root.id,
      intoWorkspaceId: dst.workspaceId,
      actorUserId: dst.userId,
    });

    const [copiedRoot] = await db.select().from(schema.pages).where(eq(schema.pages.id, newRootId));
    expect(copiedRoot?.workspaceId).toBe(dst.workspaceId);
    expect(copiedRoot?.title).toBe('Root');
    expect(copiedRoot?.icon).toBe('📦');
    expect(copiedRoot?.published).toBe(false);
    expect(copiedRoot?.publicSlug).toBeNull();
    expect(copiedRoot?.id).not.toBe(root.id);

    const copiedChildren = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.parentId, newRootId));
    expect(copiedChildren).toHaveLength(1);
    expect(copiedChildren[0]?.title).toBe('Child');
    expect(copiedChildren[0]?.id).not.toBe(child.id);
  });

  it('refuses to duplicate a page whose allow_duplication is false', async () => {
    const src = await createTestWorkspaceWithUser(db);
    const dst = await createTestWorkspaceWithUser(db);
    const { root } = await tree(src.workspaceId, src.userId);
    await publishPage(db, {
      pageId: root.id,
      workspaceId: src.workspaceId,
      actorUserId: src.userId,
    });
    await expect(
      duplicatePublicPage(db, {
        sourcePageId: root.id,
        intoWorkspaceId: dst.workspaceId,
        actorUserId: dst.userId,
      }),
    ).rejects.toThrow();
  });
});
