import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Mark a captured inbox child as triaged-in-place: set metadata.inbox = false
 * without moving the page. The page stays under the inbox parent unless the
 * caller separately moves it via the existing page-move API.
 *
 * Cross-workspace pages throw a "Page not found" error — the route handler
 * translates that to a 404 response, matching the project's never-leak-
 * existence convention (see src/lib/pages/access.ts).
 */
export async function markInboxDone(
  db: Db,
  input: { pageId: string; workspaceId: string; userId: string },
): Promise<void> {
  const [page] = await db
    .select({ metadata: schema.pages.metadata })
    .from(schema.pages)
    .where(and(eq(schema.pages.id, input.pageId), eq(schema.pages.workspaceId, input.workspaceId)))
    .limit(1);
  if (!page) throw new Error('Page not found');

  const meta = (page.metadata ?? {}) as Record<string, unknown>;
  const updated: Record<string, unknown> = { ...meta, inbox: false };

  await db
    .update(schema.pages)
    .set({ metadata: updated })
    .where(and(eq(schema.pages.id, input.pageId), eq(schema.pages.workspaceId, input.workspaceId)));

  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: 'inbox.triaged',
    targetType: 'page',
    targetId: input.pageId,
    metadata: { kind: 'mark-done' },
  });
}
