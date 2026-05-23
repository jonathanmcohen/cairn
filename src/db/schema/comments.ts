import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { CommentAnchor } from '@/lib/comments/anchor';
import type { CommentTargetType } from '@/lib/comments/target';
import { pages } from './pages';
import { users } from './users';
import { workspaces } from './workspaces';

export const commentTarget = pgEnum('comment_target', ['page', 'db_row', 'file']);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    targetType: commentTarget('target_type').$type<CommentTargetType>().notNull().default('page'),
    targetId: uuid('target_id'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    anchor: jsonb('anchor').$type<CommentAnchor>(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pageIdx: index('comments_page_idx').on(t.pageId),
    workspaceIdx: index('comments_workspace_idx').on(t.workspaceId),
    targetIdx: index('comments_target_idx').on(t.targetType, t.targetId),
  }),
);

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
