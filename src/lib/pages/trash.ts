import * as schema from '@/db/schema';
import { and, desc, eq, isNotNull, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type TrashEntry = {
  id: string;
  title: string;
  icon: string | null;
  deletedAt: Date;
};

export async function listTrash(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<TrashEntry[]> {
  const rows = await db
    .select({
      id: schema.pages.id,
      title: schema.pages.title,
      icon: schema.pages.icon,
      deletedAt: schema.pages.deletedAt,
    })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.workspaceId, workspaceId),
        isNotNull(schema.pages.deletedAt),
        eq(schema.pages.deletedRoot, true),
      ),
    )
    .orderBy(desc(schema.pages.deletedAt));

  return rows
    .filter((r): r is typeof r & { deletedAt: Date } => r.deletedAt !== null)
    .map((r) => ({ id: r.id, title: r.title, icon: r.icon, deletedAt: r.deletedAt }));
}

export type RestoreInput = {
  pageId: string;
  workspaceId: string;
};

export async function restorePage(
  db: PostgresJsDatabase<typeof schema>,
  input: RestoreInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const target = (await tx.execute(rawSql`
      SELECT id FROM pages
      WHERE id = ${input.pageId}
        AND workspace_id = ${input.workspaceId}
        AND deleted_at IS NOT NULL
        AND deleted_root = true
      LIMIT 1
    `)) as unknown as { id: string }[];
    if (target.length === 0) throw new Error('Page not in trash');

    await tx.execute(rawSql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM pages WHERE id = ${input.pageId}
        UNION ALL
        SELECT p.id FROM pages p
        INNER JOIN descendants d ON p.parent_id = d.id
        WHERE p.deleted_at IS NOT NULL
          AND p.deleted_root = false
      )
      UPDATE pages
      SET deleted_at = NULL,
          deleted_root = false
      WHERE id IN (SELECT id FROM descendants);
    `);
  });
}

export type HardDeleteInput = {
  pageId: string;
  workspaceId: string;
};

export async function hardDeletePage(
  db: PostgresJsDatabase<typeof schema>,
  input: HardDeleteInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const found = (await tx.execute(rawSql`
      SELECT id FROM pages
      WHERE id = ${input.pageId}
        AND workspace_id = ${input.workspaceId}
        AND deleted_at IS NOT NULL
        AND deleted_root = true
      LIMIT 1
    `)) as unknown as { id: string }[];
    if (found.length === 0) throw new Error('Page not in trash');

    await tx.execute(rawSql`
      DELETE FROM pages WHERE id = ${input.pageId}
    `);
    // pages.parent_id FK has ON DELETE CASCADE; descendants removed automatically.
  });
}
