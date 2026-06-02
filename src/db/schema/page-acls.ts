import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';

export const pageAcls = pgTable(
  'page_acls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'view' | 'comment' | 'edit' | 'owner' — enforced by CHECK (migration 0062)
    // and the lib layer (resolveEffectivePermission / setPageAcl).
    permission: text('permission').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pageUserUnique: uniqueIndex('page_acls_page_user_unique').on(t.pageId, t.userId),
  }),
);

export type PageAcl = typeof pageAcls.$inferSelect;
export type NewPageAcl = typeof pageAcls.$inferInsert;
export type PageAclPermission = 'view' | 'comment' | 'edit' | 'owner';
