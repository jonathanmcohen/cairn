/**
 * v0.9.0 G7 P37 — chat-bridge slash + channel-link tables.
 *
 * `chat_bridge_installs` stores the per-workspace, per-platform install secrets
 * (bot token + signing secret + opaque options blob). P36 stored chat-bridge
 * install metadata inside `webhooks.platform_metadata`; P37 adds a dedicated
 * surface so the slash + channel-sync features have a clean (workspace, team)
 * unique key without colliding with the outbound webhook rows.
 *
 * `chat_channel_links` ties one channel to one page. `link_mode='notify'` only
 * pushes outbound events; `link_mode='sync'` is bidirectional — channel
 * messages append as comments on the page (via `ingestChannelMessage`) and new
 * comments post back to the channel (via `postCommentToChannels`), with
 * `comments.chat_message_id` providing the dedupe key.
 */

import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';
import { workspaces } from './workspaces';

export const chatBridgeInstalls = pgTable(
  'chat_bridge_installs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    teamId: text('team_id').notNull(),
    botToken: text('bot_token').notNull(),
    signingSecret: text('signing_secret').notNull(),
    installedBy: uuid('installed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    options: jsonb('options').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('chat_bridge_installs_workspace_idx').on(t.workspaceId),
    uniqueIndex('chat_bridge_installs_team_uniq').on(t.workspaceId, t.platform, t.teamId),
  ],
);

export const chatChannelLinks = pgTable(
  'chat_channel_links',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    installId: uuid('install_id')
      .notNull()
      .references(() => chatBridgeInstalls.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    linkMode: text('link_mode').notNull(),
    linkedBy: uuid('linked_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chat_channel_links_workspace_idx').on(t.workspaceId),
    index('chat_channel_links_page_idx').on(t.pageId),
    uniqueIndex('chat_channel_links_channel_uniq').on(t.installId, t.channelId),
  ],
);

export type ChatBridgeInstall = typeof chatBridgeInstalls.$inferSelect;
export type NewChatBridgeInstall = typeof chatBridgeInstalls.$inferInsert;
export type ChatChannelLink = typeof chatChannelLinks.$inferSelect;
export type NewChatChannelLink = typeof chatChannelLinks.$inferInsert;
