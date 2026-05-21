import { customType, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pages } from './pages';

// Postgres bytea <-> Node Buffer. Drizzle doesn't ship a bytea helper.
export const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const pageYjs = pgTable('page_yjs', {
  pageId: uuid('page_id')
    .primaryKey()
    .references(() => pages.id, { onDelete: 'cascade' }),
  state: bytea('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PageYjs = typeof pageYjs.$inferSelect;
export type NewPageYjs = typeof pageYjs.$inferInsert;
