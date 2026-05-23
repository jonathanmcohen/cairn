import { bigint, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const workspaceQuotas = pgTable('workspace_quotas', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  storageBytesLimit: bigint('storage_bytes_limit', { mode: 'number' }), // NULL = unlimited
  storageBytesUsed: bigint('storage_bytes_used', { mode: 'number' }).notNull().default(0),
  apiRateLimitPerMin: integer('api_rate_limit_per_min'), // NULL = global default
  memberLimit: integer('member_limit'), // NULL = unlimited
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkspaceQuota = typeof workspaceQuotas.$inferSelect;
export type NewWorkspaceQuota = typeof workspaceQuotas.$inferInsert;
