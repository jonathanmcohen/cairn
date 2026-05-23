import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { pages } from './pages';
import { users } from './users';
import { workspaces } from './workspaces';

export const propertyType = pgEnum('property_type', [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'formula',
  'relation',
  'rollup',
]);
export const viewType = pgEnum('view_type', [
  'table',
  'kanban',
  'gallery',
  'calendar',
  'timeline',
  'list',
]);

export const databases = pgTable('databases', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id')
    .notNull()
    .references(() => pages.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('Untitled database'),
  config: jsonb('config').notNull().default({}),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const dbProperties = pgTable('db_properties', {
  id: uuid('id').primaryKey().defaultRandom(),
  databaseId: uuid('database_id')
    .notNull()
    .references(() => databases.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: propertyType('type').notNull(),
  config: jsonb('config').$type<unknown>().notNull().default({}),
  position: integer('position').notNull().default(0),
});

export const dbRows = pgTable('db_rows', {
  id: uuid('id').primaryKey().defaultRandom(),
  databaseId: uuid('database_id')
    .notNull()
    .references(() => databases.id, { onDelete: 'cascade' }),
  parentRowId: uuid('parent_row_id').references((): AnyPgColumn => dbRows.id, {
    onDelete: 'set null',
  }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const dbCells = pgTable(
  'db_cells',
  {
    rowId: uuid('row_id')
      .notNull()
      .references(() => dbRows.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => dbProperties.id, { onDelete: 'cascade' }),
    value: jsonb('value').$type<unknown>(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.rowId, t.propertyId] }) }),
);

export const dbViews = pgTable('db_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  databaseId: uuid('database_id')
    .notNull()
    .references(() => databases.id, { onDelete: 'cascade' }),
  type: viewType('type').notNull(),
  name: text('name').notNull(),
  config: jsonb('config').$type<unknown>().notNull().default({}),
  position: integer('position').notNull().default(0),
});

export type Database = typeof databases.$inferSelect;
export type DbProperty = typeof dbProperties.$inferSelect;
export type DbRow = typeof dbRows.$inferSelect;
export type DbCell = typeof dbCells.$inferSelect;
export type DbView = typeof dbViews.$inferSelect;
export type PropertyType = (typeof propertyType.enumValues)[number];
export type ViewType = (typeof viewType.enumValues)[number];
