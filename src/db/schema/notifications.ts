import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
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
    type: text('type').notNull(), // 'mention' | 'comment_reply' | 'reminder'
    payload: jsonb('payload').$type<NotificationPayload>().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUnreadIdx: index('notifications_user_unread_idx').on(t.userId, t.readAt),
  }),
);

export type NotificationType =
  | 'mention'
  | 'comment_reply'
  | 'reminder'
  | 'flashcards_due';
export type CommentNotificationPayload = {
  pageId: string;
  commentId: string;
  actorId: string;
};
export type ReminderNotificationPayload = {
  reminderId: string;
  databaseId: string;
  rowId: string;
  propertyId: string;
  remindAt: string;
};
export type FlashcardsDueNotificationPayload = {
  count: number;
};
export type NotificationPayload =
  | CommentNotificationPayload
  | ReminderNotificationPayload
  | FlashcardsDueNotificationPayload;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export const notificationEmailPrefs = pgTable(
  'notification_email_prefs',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    notificationType: text('notification_type').notNull(),
    emailEnabled: boolean('email_enabled').notNull().default(false),
    digestOnly: boolean('digest_only').notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.workspaceId, t.notificationType] }),
  }),
);

export type NotificationEmailPref = typeof notificationEmailPrefs.$inferSelect;
