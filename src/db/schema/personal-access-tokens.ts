import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

export const personalAccessTokens = pgTable(
  'personal_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    scopes: text('scopes').array().notNull(),
    mcpTools: text('mcp_tools').array().notNull().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // v0.9.0 G1 P9 — nullable per-token request caps + per-scope rate-limits.
    dailyRequestLimit: integer('daily_request_limit'),
    monthlyRequestLimit: integer('monthly_request_limit'),
    scopeRateLimits: jsonb('scope_rate_limits').$type<Record<string, { perMinute: number }>>(),
  },
  (t) => ({
    tokenHashUnique: uniqueIndex('personal_access_tokens_token_hash_unique').on(t.tokenHash),
    byUserWorkspace: index('personal_access_tokens_user_workspace_idx').on(t.userId, t.workspaceId),
  }),
);

export type PersonalAccessToken = typeof personalAccessTokens.$inferSelect;
export type NewPersonalAccessToken = typeof personalAccessTokens.$inferInsert;
