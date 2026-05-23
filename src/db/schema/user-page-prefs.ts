import {
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';
import { workspaces } from './workspaces';

/** Per-user, per-workspace, per-page prefs: favorites + recents source of truth. */
export const userPagePrefs = pgTable(
  'user_page_prefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    favorite: boolean('favorite').notNull().default(false),
    favoriteOrder: integer('favorite_order'),
    lastVisitedAt: timestamp('last_visited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_page_prefs_user_page_unique').on(t.userId, t.pageId),
    index('user_page_prefs_favorites_idx').on(t.userId, t.workspaceId, t.favorite, t.favoriteOrder),
    index('user_page_prefs_recents_idx').on(t.userId, t.workspaceId, t.lastVisitedAt),
  ],
);

export type UserPagePref = typeof userPagePrefs.$inferSelect;
export type NewUserPagePref = typeof userPagePrefs.$inferInsert;
