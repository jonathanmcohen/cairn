import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';

export type WalkedPage = {
  id: string;
  parentId: string | null;
  title: string;
  content: unknown;
  depth: number;
};

/**
 * Recursive-CTE walk over `pages` filtered to `workspaceId`. Depth-first
 * pre-order: a parent appears before any of its descendants, and siblings
 * are sorted by `created_at` ASC (the table has no explicit position column —
 * insertion order is the stable canonical ordering used everywhere else in
 * the codebase). Soft-deleted pages are excluded.
 *
 * Recursive CTEs go through `db.execute(rawSql)`; Drizzle's builder can't
 * express them (see CLAUDE.md "Gotchas" §recursive CTEs).
 */
export async function walkWorkspacePages(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<WalkedPage[]> {
  const rows = (await db.execute(rawSql`
    WITH RECURSIVE tree AS (
      SELECT id, parent_id, title, content, created_at, 0 AS depth,
             ARRAY[created_at]::timestamptz[] AS path
      FROM pages
      WHERE workspace_id = ${workspaceId}::uuid
        AND parent_id IS NULL
        AND deleted_at IS NULL
      UNION ALL
      SELECT p.id, p.parent_id, p.title, p.content, p.created_at, t.depth + 1,
             t.path || p.created_at
      FROM pages p
      INNER JOIN tree t ON p.parent_id = t.id
      WHERE p.workspace_id = ${workspaceId}::uuid
        AND p.deleted_at IS NULL
    )
    SELECT id, parent_id, title, content, depth
    FROM tree
    ORDER BY path;
  `)) as unknown as Array<{
    id: string;
    parent_id: string | null;
    title: string;
    content: unknown;
    depth: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    title: r.title,
    content: r.content,
    depth: r.depth,
  }));
}
