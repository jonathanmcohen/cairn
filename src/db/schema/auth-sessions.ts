import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * v0.9.6 G8b (#70) — listable + revocable session store layered ON TOP of the
 * stateless `jwt` strategy (Credentials forces `jwt`; see CLAUDE.md gotcha).
 * The Auth.js `jwt` callback mints a `sid` claim per login and inserts one row
 * here; `getAuthContext()` treats a session whose `sid` row is missing or has a
 * non-null `revoked_at` as signed out. There is NO full DB session adapter.
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('auth_sessions_user_idx').on(t.userId),
    index('auth_sessions_user_active_idx').on(t.userId, t.revokedAt),
  ],
);

export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
