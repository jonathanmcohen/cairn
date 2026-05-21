import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { workspaces } from './workspaces';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'mention' | 'comment_reply'
    payload: jsonb('payload').$type<NotificationPayload>().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUnreadIdx: index('notifications_user_unread_idx').on(t.userId, t.readAt),
  }),
);

export type NotificationType = 'mention' | 'comment_reply';
export type NotificationPayload = {
  pageId: string;
  commentId: string;
  actorId: string;
};

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
