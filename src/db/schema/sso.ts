import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * Per-workspace IdP configuration. One row per OIDC or SAML provider. The
 * `type` discriminator gates which fields of `metadata` are required:
 *   - oidc: { issuer, clientId, clientSecret, scopes?, ... }
 *   - saml: { entityId, ssoUrl, x509Cert, signRequests?, ... }
 *
 * `attribute_map` is a JSON object mapping IdP attribute names to Cairn user
 * fields, e.g. { "email": "email", "given_name": "name", "groups": "groups" }.
 *
 * Used by:
 *   - v0.9.0 G1 P2 (OIDC adapter)  — type='oidc'
 *   - v0.9.0 G1 P3 (SAML adapter)  — type='saml'
 *   - v0.9.0 G1 P4 (SCIM + admin)  — listed in /admin/sso UI
 */
export const idpConfigurations = pgTable(
  'idp_configurations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // 'oidc' | 'saml' — enforced at the application layer (Zod) since Postgres
    // text-enum migrations are heavier than the additive cost here justifies.
    type: text('type').notNull(),
    name: text('name').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    attributeMap: jsonb('attribute_map').notNull().default({}),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idp_configurations_workspace_name_uq').on(table.workspaceId, table.name),
  ],
);

/**
 * Maps an internal Cairn user to the external IdP subject id. One row per
 * (idpConfigId, externalId) pair. `raw_attrs` stores the most-recent IdP
 * attribute payload for debuggability / SCIM "lastModified" filtering.
 *
 * No `email` here — emails belong on `users`. External email changes are
 * propagated via SCIM PATCH, not stored here twice.
 */
export const externalIdentities = pgTable(
  'external_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    idpConfigId: uuid('idp_config_id')
      .notNull()
      .references(() => idpConfigurations.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    rawAttrs: jsonb('raw_attrs').notNull().default({}),
  },
  (table) => [
    uniqueIndex('external_identities_idp_external_uq').on(table.idpConfigId, table.externalId),
  ],
);

/**
 * SCIM 2.0 bearer-token registry. The plaintext token is shown to the admin
 * exactly once at mint time and discarded; only the `token_hash` (sha256, hex)
 * is stored. Scopes are a small text-array (e.g. ['users:read','users:write',
 * 'groups:read','groups:write']) — the SCIM route handler (P4) checks scopes
 * per request kind.
 */
export const scimTokens = pgTable(
  'scim_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    name: text('name').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('scim_tokens_token_hash_uq').on(table.tokenHash)],
);

export type IdpConfiguration = typeof idpConfigurations.$inferSelect;
export type NewIdpConfiguration = typeof idpConfigurations.$inferInsert;
export type ExternalIdentity = typeof externalIdentities.$inferSelect;
export type NewExternalIdentity = typeof externalIdentities.$inferInsert;
export type ScimToken = typeof scimTokens.$inferSelect;
export type NewScimToken = typeof scimTokens.$inferInsert;
