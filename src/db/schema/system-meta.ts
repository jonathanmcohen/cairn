import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const systemMeta = pgTable('system_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SystemMeta = typeof systemMeta.$inferSelect;
export type NewSystemMeta = typeof systemMeta.$inferInsert;
