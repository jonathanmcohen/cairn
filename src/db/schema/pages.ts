import {
  boolean,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    title: text('title').notNull().default('Untitled'),
    icon: text('icon'),
    content: jsonb('content')
      .$type<unknown>()
      .notNull()
      .default({
        type: 'doc',
        content: [{ type: 'paragraph' }],
      }),
    contentText: text('content_text').notNull().default(''),
    contentTsv: tsvector('content_tsv'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedRoot: boolean('deleted_root').notNull().default(false),
  },
  (t) => ({
    workspaceIdx: index('pages_workspace_idx').on(t.workspaceId),
    parentIdx: index('pages_parent_idx').on(t.parentId),
    tsvIdx: index('pages_content_tsv_idx').using('gin', t.contentTsv),
  }),
);

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
