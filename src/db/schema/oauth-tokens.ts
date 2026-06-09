import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * v0.9.16 Plan F — issued access + refresh tokens. Both hashes sha256 of their
 * plaintext (`cairn_oauth_…` / `cairn_oart_…`). One row carries both so refresh
 * rotation revokes the access+refresh pair atomically. `revoked_at` set on
 * rotation/revoke; `last_used_at` stamped fire-and-forget like PATs.
 */
export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accessTokenHash: text('access_token_hash').notNull(),
    refreshTokenHash: text('refresh_token_hash'),
    clientId: text('client_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('oauth_tokens_access_hash_unique').on(t.accessTokenHash),
    index('oauth_tokens_refresh_hash_idx').on(t.refreshTokenHash),
    index('oauth_tokens_user_idx').on(t.userId, t.workspaceId),
  ],
);

export type OauthToken = typeof oauthTokens.$inferSelect;
export type NewOauthToken = typeof oauthTokens.$inferInsert;
