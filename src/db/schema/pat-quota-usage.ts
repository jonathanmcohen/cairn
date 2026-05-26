import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { personalAccessTokens } from './personal-access-tokens';

/**
 * Per-(token, window) rollup of request + byte counts. Inserted/incremented by
 * `checkQuota` after the cap check passes. Read by the admin dashboard (P10).
 *
 * Composite primary key (token_id, window_start, window_kind) lets a single
 * `INSERT ... ON CONFLICT DO UPDATE` atomically tick the counter under race
 * (v0.9.0 G1 P9, retrospective lesson — never read-then-write quota counters).
 */
export const patQuotaUsage = pgTable(
  'pat_quota_usage',
  {
    tokenId: uuid('token_id')
      .notNull()
      .references(() => personalAccessTokens.id, { onDelete: 'cascade' }),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowKind: text('window_kind').notNull(),
    requests: integer('requests').notNull().default(0),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tokenId, t.windowStart, t.windowKind] }),
    kindCheck: check('pat_quota_usage_window_kind_chk', sql`${t.windowKind} IN ('day', 'month')`),
    tokenKindIdx: index('pat_quota_usage_token_kind_idx').on(t.tokenId, t.windowKind),
  }),
);

export type PatQuotaUsage = typeof patQuotaUsage.$inferSelect;
export type NewPatQuotaUsage = typeof patQuotaUsage.$inferInsert;
