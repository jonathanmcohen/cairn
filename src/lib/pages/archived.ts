import { sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';
import { type Breadcrumb, getBreadcrumbs } from './search';

/**
 * v0.10.0 D5 — Archived-pages browse view.
 *
 * `archived` is a lifecycle status (see `status-rules.ts`), distinct from
 * trash: the page row keeps `deleted_at IS NULL` but `flattenedPageTree`
 * hides it from the sidebar and `searchPages` excludes it from results, so
 * before this view an archived page was reachable only by direct URL. This
 * lister is the `/archived` counterpart of `listTrash` (`./trash.ts`).
 */
export type ArchivedEntry = {
  id: string;
  title: string;
  icon: string | null;
  /**
   * When the page was archived. Resolved from the newest
   * `page.status_changed` audit row whose metadata lands on `archived`
   * (written transactionally by `transitionStatus`); falls back to the row's
   * `updated_at` (also touched by the transition) for pages archived through
   * paths that predate the audit vocabulary.
   */
  archivedAt: Date;
  /** Ancestor chain, root first, excluding the page itself. May be empty. */
  parents: Breadcrumb[];
};

export async function listArchivedPages(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<ArchivedEntry[]> {
  const rows = (await db.execute(rawSql`
    SELECT p.id, p.title, p.icon,
           COALESCE(a.created_at, p.updated_at) AS archived_at
    FROM pages p
    LEFT JOIN LATERAL (
      SELECT created_at FROM audit_log
      WHERE workspace_id = p.workspace_id
        AND action = 'page.status_changed'
        AND target_type = 'page'
        AND target_id = p.id
        AND metadata->>'to' = 'archived'
      ORDER BY created_at DESC
      LIMIT 1
    ) a ON true
    WHERE p.workspace_id = ${workspaceId}
      AND p.deleted_at IS NULL
      AND p.status = 'archived'
    ORDER BY archived_at DESC, p.id ASC
  `)) as unknown as Array<{
    id: string;
    title: string;
    icon: string | null;
    archived_at: Date | string;
  }>;
  if (rows.length === 0) return [];

  // Parent context via the same resolver search results use; each chain ends
  // with the page itself, so the slice drops it.
  const breadcrumbs = await getBreadcrumbs(db, {
    pageIds: rows.map((r) => r.id),
    workspaceId,
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    icon: r.icon,
    archivedAt: new Date(r.archived_at),
    parents: (breadcrumbs.get(r.id) ?? []).slice(0, -1),
  }));
}
