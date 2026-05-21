import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';

export type SoftDeleteInput = {
  pageId: string;
  workspaceId: string;
};

export async function softDeletePage(
  db: PostgresJsDatabase<typeof schema>,
  input: SoftDeleteInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Verify the page exists in this workspace and is not already deleted.
    const target = (await tx.execute(rawSql`
      SELECT id FROM pages
      WHERE id = ${input.pageId}
        AND workspace_id = ${input.workspaceId}
        AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as { id: string }[];
    if (target.length === 0) throw new Error('Page not found');

    // Recursive CTE: collect target + all descendants, mark them deleted.
    await tx.execute(rawSql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM pages WHERE id = ${input.pageId}
        UNION ALL
        SELECT p.id FROM pages p
        INNER JOIN descendants d ON p.parent_id = d.id
        WHERE p.deleted_at IS NULL
      )
      UPDATE pages
      SET deleted_at = now(),
          deleted_root = (id = ${input.pageId})
      WHERE id IN (SELECT id FROM descendants)
    `);
  });
}
