/**
 * v0.9.0 G7 P36 — chat-bridge inbound reply ingestion.
 *
 * The route handlers (`/api/chat/slack/events` + `/api/chat/discord/events`)
 * verify the signature, parse the payload, then call `ingestInboundReply`
 * with the resolved thread reference + raw body. This module:
 *
 *   1. Looks up the posted-message log row to map `(platform, channel, thread)`
 *      back to the originating Cairn page + parent comment.
 *   2. Sanitizes the reply body (strip HTML so chat-platform formatting can't
 *      smuggle an XSS payload into a Cairn comment — v0.5.1 T3 XSS pipeline
 *      principle, applied with a small inline sanitizer since the existing
 *      sanitizer is editor-output-shaped).
 *   3. Finds or creates a synthetic per-workspace "chat-bot" user to satisfy
 *      `comments.author_id NOT NULL` (we don't have a real Cairn user for the
 *      Slack/Discord poster).
 *   4. Inserts the comment via the existing `createComment` helper so the
 *      mention + reply notification side-effects fire normally.
 *   5. Records a `chat.inbound_comment_created` audit row with sanitized
 *      metadata (platform + channel — never the raw chat payload).
 *
 * Returns the new comment id, or `null` if no matching posted-message row.
 */

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { createComment } from '@/lib/comments/create';
import { lookupPostedMessage } from './posted-log';

type Db = PostgresJsDatabase<typeof schema>;

export type InboundReplyInput = {
  platform: 'slack' | 'discord';
  channelId: string;
  threadTs?: string | null;
  messageId?: string | null;
  body: string;
  /** Platform handle of the reply author (e.g. Slack `U123` or Discord user id). */
  authorPlatformHandle: string;
  /** Platform-side display name (best-effort; falls back to the handle). */
  authorDisplayName?: string | null;
};

/**
 * Strip HTML tags from the reply body. Chat-platform reply bodies are plain
 * text by spec but Slack mrkdwn / Discord embeds can include angle-bracketed
 * fragments. We remove them and trim — Cairn comments store plain text.
 */
function sanitizeChatBody(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

const CHAT_BOT_EMAIL_PREFIX = 'cairn-chat-bot+';

/**
 * Synthetic per-workspace user the bridge writes comments as. The bot user
 * has a random non-functional password hash and no UI surface — it exists
 * only to satisfy the `comments.author_id NOT NULL` constraint.
 */
async function findOrCreateChatBotUser(db: Db, workspaceId: string): Promise<string> {
  const email = `${CHAT_BOT_EMAIL_PREFIX}${workspaceId}@cairn.local`;
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing) return existing.id;

  const [inserted] = await db
    .insert(schema.users)
    .values({
      email,
      name: 'Chat bridge',
      passwordHash: `chat-bridge-${Math.random().toString(36).slice(2)}`,
    })
    .returning({ id: schema.users.id });
  if (!inserted) throw new Error('failed to create chat-bridge bot user');

  // Add the bot as a viewer member so the workspace_members FK chain
  // (used by some comment-related queries) is satisfied.
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId, userId: inserted.id, role: 'viewer' })
    .onConflictDoNothing();

  return inserted.id;
}

export async function ingestInboundReply(
  db: Db,
  input: InboundReplyInput,
): Promise<string | null> {
  const ref = await lookupPostedMessage(db, {
    platform: input.platform,
    channelId: input.channelId,
    threadTs: input.threadTs ?? null,
    messageId: input.messageId ?? null,
  });
  if (!ref) return null;

  const sanitized = sanitizeChatBody(input.body);
  if (!sanitized) return null;

  const displayName = input.authorDisplayName?.trim() || input.authorPlatformHandle;
  const labeled = `[${input.platform}:${displayName}] ${sanitized}`;

  const botId = await findOrCreateChatBotUser(db, ref.workspaceId);

  const { comment } = await createComment(db, {
    workspaceId: ref.workspaceId,
    authorId: botId,
    body: labeled,
    target: { type: 'page', id: ref.pageId },
    anchor: null,
  });

  // Audit metadata stays scrubbed — platform + channel are operator-facing
  // ids, NOT the reply body. (Retrospective §5: don't echo raw chat payload
  // into audit.)
  await recordAudit(db, {
    workspaceId: ref.workspaceId,
    actorUserId: botId,
    action: 'chat.inbound_comment_created',
    targetType: 'comment',
    targetId: comment.id,
    metadata: {
      platform: input.platform,
      channel_id: input.channelId,
      page_id: ref.pageId,
    },
  });

  return comment.id;
}
