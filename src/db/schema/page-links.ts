import { index, pgEnum, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { pages } from './pages';

export const pageLinkKind = pgEnum('page_link_kind', ['link', 'mention', 'embed']);

export const pageLinks = pgTable(
  'page_links',
  {
    sourcePageId: uuid('source_page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    targetPageId: uuid('target_page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    kind: pageLinkKind('kind').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sourcePageId, t.targetPageId, t.kind] }),
    targetIdx: index('page_links_target_idx').on(t.targetPageId),
  }),
);

export type PageLink = typeof pageLinks.$inferSelect;
