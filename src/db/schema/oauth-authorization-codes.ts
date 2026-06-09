import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * v0.9.16 Plan F — short-lived (60 s) one-shot authorization codes. `code_hash`
 * is sha256 of the plaintext `cairn_oac_…` code (never stored plaintext). PKCE:
 * `code_challenge` is the S256 challenge bound at /authorize, verified at /token.
 * `consumed_at` flips on first exchange — a second exchange is rejected.
 */
export const oauthAuthorizationCodes = pgTable(
  'oauth_authorization_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeHash: text('code_hash').notNull(),
    clientId: text('client_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // code_hash is looked up (and consumed) on exchange — must be unique so a
    // single one-shot code resolves deterministically.
    uniqueIndex('oauth_auth_codes_code_hash_unique').on(t.codeHash),
    index('oauth_auth_codes_client_idx').on(t.clientId),
  ],
);

export type OauthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
export type NewOauthAuthorizationCode = typeof oauthAuthorizationCodes.$inferInsert;
