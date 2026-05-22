import { index, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';

export const suggestionStatus = pgEnum('suggestion_status', ['open', 'accepted', 'rejected']);

export const suggestions = pgTable(
  'suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    status: suggestionStatus('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id),
  },
  (t) => [index('suggestions_page_status_idx').on(t.pageId, t.status)],
);
