import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

export const tokenUsageLog = pgTable(
  'token_usage_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // 'api_key' | 'pat'  — discriminator; FK enforced at the lib layer
    tokenKind: text('token_kind').notNull(),
    tokenId: uuid('token_id').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    route: text('route').notNull(), // already-templated; never a concrete-id route
    status: integer('status').notNull(),
    mcpTool: text('mcp_tool'), // non-null only for MCP tool calls
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTokenCreatedAt: index('token_usage_log_token_id_created_at_idx').on(t.tokenId, t.createdAt),
    byWorkspaceCreatedAt: index('token_usage_log_workspace_id_created_at_idx').on(
      t.workspaceId,
      t.createdAt,
    ),
  }),
);

export type TokenUsageLog = typeof tokenUsageLog.$inferSelect;
export type NewTokenUsageLog = typeof tokenUsageLog.$inferInsert;
export type TokenKind = 'api_key' | 'pat';
