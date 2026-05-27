/**
 * v0.9.0 G7 P37 — chat-bridge dedupe helper.
 *
 * Channel-message → page-comment ingestion uses the `comments.chat_message_id`
 * column (added in migration 0052) as the unique-per-page key. Each ingest
 * checks `isMessageProcessed` first; if false, inserts a comment via
 * `markMessageProcessed`. Two invocations with the same `(pageId,
 * chatMessageId)` collapse to one comment, breaking the channel↔page echo
 * loop alongside the bot-user-id skip in `ingestChannelMessage`.
 *
 * NB: not transactional. A concurrent double-fire could race and produce two
 * rows; the `comments_chat_message_id_idx` is non-unique by design because
 * `chat_message_id` is nullable. In practice Slack + Discord send `event_id`s
 * AT-LEAST-ONCE; the de-facto dedupe window is the few seconds it takes a
 * single ingestion to round-trip, which our pool keeps single-threaded enough.
 */

import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export async function isMessageProcessed(input: {
  pageId: string;
  chatMessageId: string;
  db?: Db;
}): Promise<boolean> {
  const db = input.db ?? getDb();
  const rows = await db
    .select({ id: schema.comments.id })
    .from(schema.comments)
    .where(
      and(
        eq(schema.comments.pageId, input.pageId),
        eq(schema.comments.chatMessageId, input.chatMessageId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function markMessageProcessed(input: {
  workspaceId: string;
  pageId: string;
  authorUserId: string;
  chatMessageId: string;
  body: string;
  db?: Db;
}): Promise<{ commentId: string }> {
  const db = input.db ?? getDb();
  const [row] = await db
    .insert(schema.comments)
    .values({
      workspaceId: input.workspaceId,
      pageId: input.pageId,
      authorId: input.authorUserId,
      body: input.body,
      chatMessageId: input.chatMessageId,
    })
    .returning({ id: schema.comments.id });
  if (!row) throw new Error('markMessageProcessed: insert returned no row');
  return { commentId: row.id };
}
