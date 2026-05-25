import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Returns the workspace's inbox page id, lazily creating it (and recording
 * the pointer in `workspaces.inbox_page_id`) on first call. Idempotent: a
 * second call returns the existing id.
 *
 * The inbox page is a normal `pages` row with title "Inbox", no parent, and
 * empty ProseMirror content — readers and editors render it the same way as
 * any other page. `metadata.systemPage = 'inbox'` marks it so the future
 * onboarding wizard / triage logic can spot it without joining workspaces.
 *
 * The create path runs in a transaction with a `SELECT ... FOR UPDATE` re-
 * check to avoid a double-create race when two parallel captures both land
 * with `inboxPageId === null` on the first read.
 */
export async function ensureInboxPage(
  db: Db,
  input: { workspaceId: string; userId: string },
): Promise<string> {
  const [ws] = await db
    .select({ inboxPageId: schema.workspaces.inboxPageId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, input.workspaceId))
    .limit(1);
  if (!ws) throw new Error('workspace not found');
  if (ws.inboxPageId) return ws.inboxPageId;

  return db.transaction(async (tx) => {
    // Re-check inside the tx (FOR UPDATE on the workspace row) to avoid a
    // double-create race when two parallel captures both saw a null pointer.
    const [pinned] = await tx
      .select({ inboxPageId: schema.workspaces.inboxPageId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, input.workspaceId))
      .for('update');
    if (pinned?.inboxPageId) return pinned.inboxPageId;

    const [page] = await tx
      .insert(schema.pages)
      .values({
        workspaceId: input.workspaceId,
        parentId: null,
        title: 'Inbox',
        icon: null,
        content: { type: 'doc', content: [] },
        metadata: { systemPage: 'inbox' },
        createdBy: input.userId,
      })
      .returning({ id: schema.pages.id });
    if (!page) throw new Error('ensureInboxPage: insert returned no row');

    await tx
      .update(schema.workspaces)
      .set({ inboxPageId: page.id })
      .where(eq(schema.workspaces.id, input.workspaceId));

    return page.id;
  });
}
