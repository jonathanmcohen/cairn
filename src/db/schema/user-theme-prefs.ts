import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Per-user theme preferences. Single row per user (PK = user_id). Plain text
 * columns instead of pg-enum so future accents/fonts/page-widths can be added
 * without a migration — validation lives in `src/lib/themes/presets.ts`.
 */
export const userThemePrefs = pgTable('user_theme_prefs', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  accent: text('accent').notNull().default('default'),
  fontFamily: text('font_family').notNull().default('system'),
  pageWidth: text('page_width').notNull().default('wide'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserThemePrefs = typeof userThemePrefs.$inferSelect;
export type NewUserThemePrefs = typeof userThemePrefs.$inferInsert;
