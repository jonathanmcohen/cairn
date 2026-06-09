import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * v0.9.16 Plan F — RFC 7591 dynamically-registered OAuth clients. `client_secret_hash`
 * is null for public (PKCE) clients (Claude Desktop / Cursor). `redirect_uris` is the
 * exact-match allowlist enforced at /authorize and /token.
 */
export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: text('client_id').notNull(),
    clientSecretHash: text('client_secret_hash'),
    clientName: text('client_name').notNull(),
    redirectUris: text('redirect_uris').array().notNull(),
    grantTypes: text('grant_types')
      .array()
      .notNull()
      .default(['authorization_code', 'refresh_token']),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // client_id is the public identifier looked up at /authorize and /token; it
  // must be unique so a single client row resolves deterministically.
  (t) => [uniqueIndex('oauth_clients_client_id_idx').on(t.clientId)],
);

export type OauthClient = typeof oauthClients.$inferSelect;
export type NewOauthClient = typeof oauthClients.$inferInsert;
