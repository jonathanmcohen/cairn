/**
 * v0.9.0 G7 P36 — chat-bridge posted-message log helpers.
 *
 * Outbound: after a successful Slack/Discord delivery, `recordPostedMessage`
 * persists a row mapping `(platform, channel, thread_ts | message_id) → page`.
 *
 * Inbound: when a chat-platform reply arrives, `lookupPostedMessage` resolves
 * the thread back to a `(workspaceId, pageId, parentCommentId?)` tuple so the
 * inbound handler (Task 6) can create a Cairn comment threaded correctly.
 *
 * Schema lives in `src/db/schema/chat-posted-messages.ts`; the unique index on
 * `(platform, channel_id, thread_ts)` lets us treat write-on-success as
 * idempotent (`ON CONFLICT DO NOTHING`).
 */

import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

export type RecordPostedMessageInput = {
  workspaceId: string;
  pageId: string;
  platform: 'slack' | 'discord';
  channelId: string;
  messageId: string;
  threadTs?: string | null;
  parentCommentId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordPostedMessage(db: Db, input: RecordPostedMessageInput): Promise<void> {
  await db
    .insert(schema.chatPostedMessages)
    .values({
      workspaceId: input.workspaceId,
      pageId: input.pageId,
      platform: input.platform,
      channelId: input.channelId,
      messageId: input.messageId,
      threadTs: input.threadTs ?? null,
      parentCommentId: input.parentCommentId ?? null,
      metadata: input.metadata ?? null,
    })
    .onConflictDoNothing();
}

export type LookupPostedMessageInput = {
  platform: 'slack' | 'discord';
  channelId: string;
  threadTs?: string | null;
  messageId?: string | null;
};

/**
 * Resolve a chat-platform thread or message id back to a logged posted-message
 * row. Prefer `threadTs` (Slack thread / Discord reference) when present;
 * otherwise fall back to `messageId`. Returns `null` if no match — callers
 * MUST treat this as a normal no-op (the user replied in a non-Cairn thread).
 */
export async function lookupPostedMessage(
  db: Db,
  input: LookupPostedMessageInput,
): Promise<schema.ChatPostedMessage | null> {
  const filters = [
    eq(schema.chatPostedMessages.platform, input.platform),
    eq(schema.chatPostedMessages.channelId, input.channelId),
  ];
  if (input.threadTs) {
    filters.push(eq(schema.chatPostedMessages.threadTs, input.threadTs));
  } else if (input.messageId) {
    filters.push(eq(schema.chatPostedMessages.messageId, input.messageId));
  } else {
    // Neither identifier provided — there's nothing to look up.
    return null;
  }
  const [row] = await db
    .select()
    .from(schema.chatPostedMessages)
    .where(and(...filters))
    .limit(1);
  return row ?? null;
}
