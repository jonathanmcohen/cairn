import * as schema from '@/db/schema';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
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
