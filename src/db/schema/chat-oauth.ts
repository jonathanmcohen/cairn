/**
 * v0.9.8 G6 (audit F) — chat OAuth installs.
 *
 * Distinct from the legacy `webhooks` rows (manual webhook+secret fallback) and
 * the P37 `chat_bridge_installs` table: this records full-OAuth installs only.
 * `bot_token_encrypted` is an AES-256-GCM envelope (src/lib/crypto/secret-box.ts);
 * the plaintext token never leaves the server and is never logged.
 */

import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

// Postgres bytea — Drizzle has no first-class bytea (matches src/db/schema/e2e.ts).
const bytea = customType<{ data: Buffer; default: false; notNull: true }>({
  dataType() {
    return 'bytea';
  },
});

export const chatOauthInstalls = pgTable(
  'chat_oauth_installs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // 'slack' | 'discord' — guarded by a CHECK constraint appended in the migration.
    platform: text('platform').notNull(),
    externalTeamId: text('external_team_id').notNull(),
    botTokenEncrypted: bytea('bot_token_encrypted').notNull(),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    installedBy: uuid('installed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('chat_oauth_installs_workspace_idx').on(t.workspaceId),
    uniqueIndex('chat_oauth_installs_team_uniq').on(t.workspaceId, t.platform, t.externalTeamId),
  ],
);

export type ChatOauthInstall = typeof chatOauthInstalls.$inferSelect;
export type NewChatOauthInstall = typeof chatOauthInstalls.$inferInsert;
