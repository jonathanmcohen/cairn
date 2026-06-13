import { and, count, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * v0.10.2 S9 — count of still-untriaged inbox captures for a workspace.
 *
 * Mirrors the /inbox page's list query exactly (children of the workspace's
 * inbox page with `metadata->>'inbox' = 'true'`) so the sidebar badge always
 * equals the number of rows the triage list renders. Pure COUNT — no row
 * payloads — cheap enough for the sidebar to fetch on every mount.
 *
 * Unlike the page, this NEVER lazy-creates the inbox page: a count read must
 * stay side-effect free. No `workspaces.inbox_page_id` pointer → nothing has
 * ever been captured → 0.
 */
export async function countInboxItems(db: Db, input: { workspaceId: string }): Promise<number> {
  const [ws] = await db
    .select({ inboxPageId: schema.workspaces.inboxPageId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, input.workspaceId))
    .limit(1);
  if (!ws?.inboxPageId) return 0;

  const [row] = await db
    .select({ value: count() })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.workspaceId, input.workspaceId),
        eq(schema.pages.parentId, ws.inboxPageId),
        sql`(${schema.pages.metadata} ->> 'inbox') = 'true'`,
      ),
    );
  return row?.value ?? 0;
}
