import { and, desc, eq, ilike, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

export type PageSearchResult = { id: string; title: string; icon: string | null };

/**
 * Pages of `workspaceId` whose title matches `query` (ILIKE substring), excluding
 * soft-deleted pages. An empty query returns the most recently updated pages so
 * the [[ / @@ page picker can show something on the bare trigger. Workspace-scoped.
 */
export async function searchWorkspacePages(
  db: PostgresJsDatabase<typeof schema>,
  input: { workspaceId: string; query: string; limit?: number },
): Promise<PageSearchResult[]> {
  const limit = input.limit ?? 10;
  const q = input.query.trim();
  return db
    .select({ id: schema.pages.id, title: schema.pages.title, icon: schema.pages.icon })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.workspaceId, input.workspaceId),
        isNull(schema.pages.deletedAt),
        q.length > 0 ? ilike(schema.pages.title, `%${q}%`) : undefined,
      ),
    )
    .orderBy(desc(schema.pages.updatedAt))
    .limit(limit);
}
