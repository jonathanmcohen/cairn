import { and, eq, isNull, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type MovePageInput = {
  pageId: string;
  workspaceId: string;
  newParentId: string | null;
};

export async function movePage(
  db: PostgresJsDatabase<typeof schema>,
  input: MovePageInput,
): Promise<void> {
  if (input.newParentId === input.pageId) {
    throw new Error('Cannot move a page under itself (cycle)');
  }

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, input.pageId),
          eq(schema.pages.workspaceId, input.workspaceId),
          isNull(schema.pages.deletedAt),
        ),
      )
      .limit(1);
    if (!target) throw new Error('Page not found');

    if (input.newParentId) {
      const [parent] = await tx
        .select()
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, input.newParentId),
            eq(schema.pages.workspaceId, input.workspaceId),
            isNull(schema.pages.deletedAt),
          ),
        )
        .limit(1);
      if (!parent) throw new Error('Parent page is missing or in a different workspace');

      // Cycle check: is the new parent in the target's descendant subtree?
      const result = (await tx.execute(rawSql`
        WITH RECURSIVE descendants AS (
          SELECT id FROM pages WHERE id = ${input.pageId}
          UNION ALL
          SELECT p.id FROM pages p
          INNER JOIN descendants d ON p.parent_id = d.id
        )
        SELECT count(*)::int AS count FROM descendants WHERE id = ${input.newParentId}
      `)) as unknown as { count: number }[];
      const count = Number(result[0]?.count ?? 0);
      if (count > 0) throw new Error('Cycle detected: new parent is a descendant of the target');
    }

    await tx
      .update(schema.pages)
      .set({ parentId: input.newParentId })
      .where(eq(schema.pages.id, input.pageId));
  });
}
