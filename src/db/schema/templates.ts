import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }), // null = built-in/global
    name: text('name').notNull(),
    kind: text('kind').notNull(), // page|database
    payload: jsonb('payload').notNull(),
    builtIn: boolean('built_in').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkspaceKindIdx: index('templates_workspace_id_kind_idx').on(t.workspaceId, t.kind),
  }),
);

export type Template = typeof templates.$inferSelect;
