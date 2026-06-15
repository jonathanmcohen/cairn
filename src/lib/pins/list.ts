import { and, asc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

/**
 * v0.9.0 G2 P12 — Row shape for the workspace-pinned sidebar section.
 *
 * The shape matches what the sidebar + admin UI need to render a row: page
 * id + title + icon for display, position for the drag-reorder client, and
 * the actor/timestamp pair for the admin tooltip. Never includes page
 * content — pins are public-to-workspace metadata, content is gated by the
 * page ACL chain.
 */
export type PinRow = {
  pageId: string;
  title: string;
  icon: string | null;
  position: number;
  pinnedBy: string;
  pinnedAt: Date;
};

/**
 * Return ordered workspace pins joined to `pages` for display metadata.
 *
 * Soft-deleted pages (`pages.deleted_at IS NOT NULL`) are intentionally
 * excluded — a pin to a trashed page should disappear from the sidebar until
 * the page is restored. The `workspace_pins.workspace_id` cascade on page
 * delete (HARD delete) means the row will never survive a full delete; this
 * filter handles the trash-state interim.
 */
/**
 * v0.10.3 Q-18 — cheap existence check for the page-menu "Pin / Unpin" toggle.
 * Indexed PK lookup on (workspace_id, page_id); does not join `pages`, so it
 * answers true even for a trashed page (the row only vanishes on hard delete).
 */
export async function isWorkspacePinned(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  pageId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ pageId: schema.workspacePins.pageId })
    .from(schema.workspacePins)
    .where(
      and(
        eq(schema.workspacePins.workspaceId, workspaceId),
        eq(schema.workspacePins.pageId, pageId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function listWorkspacePins(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<PinRow[]> {
  return await db
    .select({
      pageId: schema.workspacePins.pageId,
      title: schema.pages.title,
      icon: schema.pages.icon,
      position: schema.workspacePins.position,
      pinnedBy: schema.workspacePins.pinnedBy,
      pinnedAt: schema.workspacePins.pinnedAt,
    })
    .from(schema.workspacePins)
    .innerJoin(schema.pages, eq(schema.pages.id, schema.workspacePins.pageId))
    .where(and(eq(schema.workspacePins.workspaceId, workspaceId), isNull(schema.pages.deletedAt)))
    .orderBy(asc(schema.workspacePins.position), asc(schema.pages.title));
}
