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
    coverUrl: text('cover_url'),
    published: boolean('published').notNull().default(false),
    publicSlug: text('public_slug').unique(),
    linkPasswordHash: text('link_password_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    allowDuplication: boolean('allow_duplication').notNull().default(false),
    content: jsonb('content')
      .$type<unknown>()
      .notNull()
      .default({
        type: 'doc',
        content: [{ type: 'paragraph' }],
      }),
    // v0.8.0 G3 P8 — free-form per-page metadata (inbox flags, capturedAt,
    // sourceUrl, systemPage marker, etc). Defaults to {} so existing rows
    // and inserts that don't set it remain valid.
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
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
