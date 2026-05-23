import { and, asc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Resolve the page to land on when a workspace is opened:
 *   1. workspaces.home_page_id, if set AND the page is live + in-workspace;
 *   2. the first (oldest live) page in the workspace;
 *   3. null when the workspace has no live pages.
 *
 * `userId` is accepted for future "last-visited" preference (P16 favorites/recents
 * could feed this), currently unused — kept for forward compatibility.
 */
export async function resolveLandingPage(
  db: Db,
  input: { workspaceId: string; userId: string },
): Promise<string | null> {
  const [ws] = await db
    .select({ homePageId: schema.workspaces.homePageId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, input.workspaceId));

  if (ws?.homePageId) {
    const [home] = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, ws.homePageId),
          eq(schema.pages.workspaceId, input.workspaceId),
          isNull(schema.pages.deletedAt),
        ),
      );
    if (home) return home.id;
  }

  const [first] = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(and(eq(schema.pages.workspaceId, input.workspaceId), isNull(schema.pages.deletedAt)))
    .orderBy(asc(schema.pages.createdAt))
    .limit(1);
  return first?.id ?? null;
}
