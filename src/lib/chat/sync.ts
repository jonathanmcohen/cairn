/**
 * v0.9.0 G7 P37 — channel ↔ page sync engine.
 *
 * `ingestChannelMessage`: inbound path. A message arrived from Slack/Discord
 * on a channel that has a `chat_channel_links` row. If the link mode is
 * `'sync'` and the message isn't from the install's own bot user (echo guard)
 * and we haven't already processed this `(pageId, chatMessageId)` (dedupe),
 * sanitize the body and insert a comment with `chat_message_id` set.
 *
 * `postCommentToChannels`: outbound path. A comment was just created in the
 * UI (i.e. its `chat_message_id` is still null — see Task 6). For every
 * `'sync'` link on the page, call the platform's post-message API and let
 * the chat platform's webhook re-deliver the message; that round-trip
 * resolves to a duplicate insert attempt that `isMessageProcessed` short-
 * circuits. Comments that ALREADY carry a `chat_message_id` (i.e. they
 * originated from chat) are skipped at the caller site (route handler) to
 * keep the side-effect surface narrow.
 *
 * Encrypted-page filter: pages with `encrypted=true` are excluded from
 * sync — the bridge can't read plaintext from the page and can't write
 * comments under the workspace E2E policy without leaking ciphertext into
 * a chat channel.
 */

import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { isMessageProcessed, markMessageProcessed } from './dedupe';
import { checkRateLimit } from './ratelimit';

type Db = PostgresJsDatabase<typeof schema>;

export type IngestResult =
  | { kind: 'inserted'; commentId: string }
  | { kind: 'duplicate' }
  | { kind: 'skipped_mode' }
  | { kind: 'skipped_bot' }
  | { kind: 'skipped_rate_limit' }
  | { kind: 'skipped_encrypted' }
  | { kind: 'link_not_found' };

/**
 * Strip HTML tags + collapse whitespace. Chat reply bodies are plain text by
 * spec; we apply the same defense-in-depth scrub as the P36 inbound path so
 * Slack mrkdwn / Discord markdown can't smuggle markup into a Cairn comment.
 */
function sanitizeChatBody(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

export async function ingestChannelMessage(input: {
  installId: string;
  channelId: string;
  messageId: string;
  authorChatUserId: string;
  body: string;
  db?: Db;
}): Promise<IngestResult> {
  const db = input.db ?? getDb();

  const [install] = await db
    .select()
    .from(schema.chatBridgeInstalls)
    .where(eq(schema.chatBridgeInstalls.id, input.installId))
    .limit(1);
  if (!install) return { kind: 'link_not_found' };

  const botUserId = (install.options as { botUserId?: string } | null)?.botUserId ?? null;
  if (botUserId && botUserId === input.authorChatUserId) {
    return { kind: 'skipped_bot' };
  }

  const [link] = await db
    .select()
    .from(schema.chatChannelLinks)
    .where(
      and(
        eq(schema.chatChannelLinks.installId, input.installId),
        eq(schema.chatChannelLinks.channelId, input.channelId),
      ),
    )
    .limit(1);
  if (!link) return { kind: 'link_not_found' };
  if (link.linkMode !== 'sync') return { kind: 'skipped_mode' };

  // Encrypted-page filter (E2E v0.9 G1 P6/P7): refuse to mirror a chat message
  // into an encrypted page — the bridge holds no E2E key.
  const [page] = await db
    .select({ encrypted: schema.pages.encrypted })
    .from(schema.pages)
    .where(eq(schema.pages.id, link.pageId))
    .limit(1);
  if (page?.encrypted) return { kind: 'skipped_encrypted' };

  const customLimit = (install.options as { rateLimit?: number } | null)?.rateLimit ?? undefined;
  const rl = await checkRateLimit({
    workspaceId: install.workspaceId,
    limit: customLimit,
  });
  if (!rl.allowed) return { kind: 'skipped_rate_limit' };

  if (
    await isMessageProcessed({
      pageId: link.pageId,
      chatMessageId: input.messageId,
      db,
    })
  ) {
    return { kind: 'duplicate' };
  }

  const sanitized = sanitizeChatBody(input.body);
  if (!sanitized) return { kind: 'duplicate' };

  const { commentId } = await markMessageProcessed({
    workspaceId: install.workspaceId,
    pageId: link.pageId,
    authorUserId: install.installedBy,
    chatMessageId: input.messageId,
    body: sanitized,
    db,
  });
  return { kind: 'inserted', commentId };
}

export type PostFnArgs = {
  platform: 'slack' | 'discord';
  channelId: string;
  body: string;
  botToken: string;
};

/**
 * Fan a freshly-created comment out to every linked sync channel. Skips
 * channels whose page no longer exists, rate-limit-exceeded workspaces, and
 * encrypted pages. Returns the number of post attempts that succeeded (i.e.
 * the postFn resolved without throwing).
 */
export async function postCommentToChannels(input: {
  workspaceId: string;
  pageId: string;
  body: string;
  postFn: (args: PostFnArgs) => Promise<void>;
  db?: Db;
}): Promise<{ posted: number }> {
  const db = input.db ?? getDb();

  // Encrypted-page filter — same reasoning as the inbound path.
  const [page] = await db
    .select({ encrypted: schema.pages.encrypted })
    .from(schema.pages)
    .where(eq(schema.pages.id, input.pageId))
    .limit(1);
  if (!page || page.encrypted) return { posted: 0 };

  const links = await db
    .select({
      link: schema.chatChannelLinks,
      install: schema.chatBridgeInstalls,
    })
    .from(schema.chatChannelLinks)
    .innerJoin(
      schema.chatBridgeInstalls,
      eq(schema.chatChannelLinks.installId, schema.chatBridgeInstalls.id),
    )
    .where(
      and(
        eq(schema.chatChannelLinks.workspaceId, input.workspaceId),
        eq(schema.chatChannelLinks.pageId, input.pageId),
        eq(schema.chatChannelLinks.linkMode, 'sync'),
      ),
    );

  let posted = 0;
  for (const row of links) {
    const customLimit =
      (row.install.options as { rateLimit?: number } | null)?.rateLimit ?? undefined;
    const rl = await checkRateLimit({
      workspaceId: input.workspaceId,
      limit: customLimit,
    });
    if (!rl.allowed) continue;
    try {
      await input.postFn({
        platform: row.install.platform as 'slack' | 'discord',
        channelId: row.link.channelId,
        body: input.body,
        botToken: row.install.botToken,
      });
      posted += 1;
    } catch {
      // Swallow per-channel post failures so a single dead webhook doesn't
      // strand the rest of the fan-out. The caller logs.
    }
  }
  return { posted };
}
