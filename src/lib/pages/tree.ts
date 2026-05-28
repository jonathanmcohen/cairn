import { and, asc, eq, isNull, notInArray, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type PageTreeNode = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  children: PageTreeNode[];
};

export async function getPageTree(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<PageTreeNode[]> {
  const rows = await db
    .select({
      id: schema.pages.id,
      parentId: schema.pages.parentId,
      title: schema.pages.title,
      icon: schema.pages.icon,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt)))
    .orderBy(asc(schema.pages.createdAt));

  const byId = new Map<string, PageTreeNode>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }
  const roots: PageTreeNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    if (row.parentId) {
      const parent = byId.get(row.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node); // orphan defensively becomes a root
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * One row per visible page, in depth-first order with `depth` annotated.
 * Used by the virtualized sidebar (v0.8 P4): the client renders a windowed
 * flat list keyed by index, never the recursive tree, so indentation is
 * style-only (`paddingLeft: depth * 16px`) and 10k pages don't blow out the
 * DOM. Same row-set as `getPageTree`; only the post-processing differs.
 *
 * Orphans (parentId not in this workspace) become roots — same as `getPageTree`.
 */
export type FlatPageNode = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  depth: number;
  // v0.9.0 G2 P11 — optional space pointer used by the sidebar to group rows
  // under a space-header row. `null` (or undefined) means the page lives in
  // the synthetic "Unfiled" bucket at the bottom of the tree.
  spaceId?: string | null;
};

export async function flattenedPageTree(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  viewerUserId?: string,
): Promise<FlatPageNode[]> {
  // v0.9.0 G4 P26 — lifecycle status visibility:
  //   - `archived` pages are hidden from the sidebar entirely (still reachable
  //     via /archived);
  //   - `draft` pages are visible only to their author (viewerUserId match);
  //   - `review` + `published` are always visible to workspace members.
  // When viewerUserId is undefined (callers that don't have an auth context —
  // e.g. background jobs, fixtures), we fall back to the strict view: only
  // non-draft, non-archived pages.
  const statusFilter = viewerUserId
    ? or(
        notInArray(schema.pages.status, ['draft', 'archived']),
        and(eq(schema.pages.status, 'draft'), eq(schema.pages.createdBy, viewerUserId)),
      )
    : notInArray(schema.pages.status, ['draft', 'archived']);

  const rows = await db
    .select({
      id: schema.pages.id,
      parentId: schema.pages.parentId,
      title: schema.pages.title,
      icon: schema.pages.icon,
      spaceId: schema.pages.spaceId,
    })
    .from(schema.pages)
    .where(
      and(eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt), statusFilter),
    )
    .orderBy(asc(schema.pages.createdAt));

  // Bucket children-by-parent so the DFS doesn't re-scan rows per node.
  const childrenByParent = new Map<string | null, typeof rows>();
  const rowIds = new Set(rows.map((r) => r.id));
  for (const row of rows) {
    // Treat unknown parents as roots (parent not in workspace / deleted).
    const key = row.parentId && rowIds.has(row.parentId) ? row.parentId : null;
    const bucket = childrenByParent.get(key) ?? [];
    bucket.push(row);
    childrenByParent.set(key, bucket);
  }

  const out: FlatPageNode[] = [];
  const visit = (parent: string | null, depth: number): void => {
    const bucket = childrenByParent.get(parent) ?? [];
    for (const row of bucket) {
      out.push({
        id: row.id,
        parentId: row.parentId,
        title: row.title,
        icon: row.icon,
        depth,
      });
      visit(row.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}
