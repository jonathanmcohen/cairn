import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';

export const pageVersions = pgTable(
  'page_versions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    content: jsonb('content').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPageIdx: index('page_versions_page_id_created_at_idx').on(t.pageId, t.createdAt.desc()),
  }),
);

export type PageVersion = typeof pageVersions.$inferSelect;
