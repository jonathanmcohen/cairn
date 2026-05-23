import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { databases, dbRows } from './databases';
import { users } from './users';
import { workspaces } from './workspaces';

export const reminders = pgTable('reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  databaseId: uuid('database_id')
    .notNull()
    .references(() => databases.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id').notNull(),
  rowId: uuid('row_id')
    .notNull()
    .references(() => dbRows.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  remindAt: timestamp('remind_at', { withTimezone: true }).notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }), // NULL until fired
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
