import * as schema from '@/db/schema';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

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
