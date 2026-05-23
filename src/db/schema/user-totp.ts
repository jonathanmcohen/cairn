import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bytea } from './page-yjs';
import { users } from './users';

export const userTotp = pgTable('user_totp', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretEncrypted: bytea('secret_encrypted').notNull(),
  recoveryCodes: jsonb('recovery_codes').notNull().default([]),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserTotp = typeof userTotp.$inferSelect;
export type NewUserTotp = typeof userTotp.$inferInsert;
