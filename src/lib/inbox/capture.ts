import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { ensureInboxPage } from './lazy-page';

type Db = PostgresJsDatabase<typeof schema>;

export type InboxCapturePayload = {
  title: string;
  body: string;
  url: string | null;
};

export type InboxCaptureResult = {
  capturedPageId: string;
  inboxPageId: string;
};

/**
 * Append a captured page under the workspace's inbox page. Tags the child's
 * metadata with `{inbox: true, capturedAt}` so the triage UI can surface it
 * and the "mark done" action can flip the flag without moving the page.
 *
 * `body` becomes a single paragraph block; `url` (if present) becomes a
 * second paragraph holding a bookmark-style link plus is recorded on the
 * metadata as `sourceUrl` for later round-trips.
 */
export async function captureInbox(
  db: Db,
  input: { workspaceId: string; userId: string; payload: InboxCapturePayload },
): Promise<InboxCaptureResult> {
  const inboxPageId = await ensureInboxPage(db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });

  const title = input.payload.title.trim() || 'Untitled capture';
  const bodyTrim = input.payload.body.trim();
  const blocks: Array<Record<string, unknown>> = [];
  if (bodyTrim.length > 0) {
    blocks.push({ type: 'paragraph', content: [{ type: 'text', text: bodyTrim }] });
  }
  if (input.payload.url) {
    blocks.push({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: input.payload.url,
          marks: [{ type: 'link', attrs: { href: input.payload.url } }],
        },
      ],
    });
  }

  const capturedAt = new Date().toISOString();
  const metadata: Record<string, unknown> = {
    inbox: true,
    capturedAt,
  };
  if (input.payload.url) metadata.sourceUrl = input.payload.url;

  const [row] = await db
    .insert(schema.pages)
    .values({
      workspaceId: input.workspaceId,
      parentId: inboxPageId,
      title,
      icon: null,
      content: { type: 'doc', content: blocks },
      metadata,
      createdBy: input.userId,
    })
    .returning({ id: schema.pages.id });
  if (!row) throw new Error('captureInbox: insert returned no row');
  const capturedPageId = row.id;

  await recordAudit(db, {
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: 'inbox.captured',
    targetType: 'page',
    targetId: capturedPageId,
    metadata: { hasUrl: input.payload.url !== null, hasBody: bodyTrim.length > 0 },
  });

  return { capturedPageId, inboxPageId };
}
