import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { comments } from './comments';
import { pages } from './pages';
import { workspaces } from './workspaces';

/**
 * v0.9.0 G7 P36 — chat-bridge posted-message log.
 *
 * Maps a successful outbound Slack/Discord post back to the originating Cairn
 * page (+ optional parent comment) so that an inbound reply can resolve a
 * `(platform, channel_id, thread_ts | message_id)` tuple to a page id and
 * thread a comment underneath it.
 *
 * One row per successful delivery — written from the dispatcher after a 2xx
 * response. Deleted via FK cascade when the workspace or page is deleted
 * (parent_comment_id nulls so an old reply still resolves to the page if the
 * parent comment was removed).
 */
export const chatPostedMessages = pgTable(
  'chat_posted_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // 'slack' | 'discord' — enforced by app code; we keep it text so future
    // platforms (Teams, Mattermost) drop in without a migration.
    platform: text('platform').notNull(),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    // Slack threads use `thread_ts` (the timestamp of the parent message);
    // Discord uses message_reference.message_id. Null for non-threaded posts.
    threadTs: text('thread_ts'),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    parentCommentId: uuid('parent_comment_id').references(() => comments.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Inbound resolution: (platform, channel, thread_ts) uniquely identifies a
    // thread so we can SELECT...LIMIT 1. The unique constraint also protects
    // us from accidental double-writes if a delivery retries past a 2xx.
    uniqueIndex('chat_posted_messages_thread_unique').on(t.platform, t.channelId, t.threadTs),
    // Fallback for non-threaded posts: lookup by message id directly.
    index('chat_posted_messages_message_idx').on(t.platform, t.channelId, t.messageId),
    // Workspace-scoped admin/audit queries.
    index('chat_posted_messages_workspace_idx').on(t.workspaceId),
  ],
);

export type ChatPostedMessage = typeof chatPostedMessages.$inferSelect;
export type NewChatPostedMessage = typeof chatPostedMessages.$inferInsert;
