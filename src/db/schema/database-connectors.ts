import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { databases } from './databases';
import { bytea } from './page-yjs';
import { users } from './users';
import { workspaces } from './workspaces';

/**
 * One external-system connector per database. The framework is provider-agnostic:
 * `kind` picks the adapter at runtime, `sync_config` carries adapter-specific
 * mapping (sheet id, column map, poll interval, ...), `auth_config` is the
 * encrypted credentials envelope (sealed via src/lib/connectors/auth.ts).
 *
 * UNIQUE(database_id) enforces "one connector per database" — P19 ships the
 * framework only; P20 (Sheets), P21 (Airtable), P22 (CSV) each register their
 * own adapter via `src/lib/connectors/registry.ts#register`.
 */
export const databaseConnectors = pgTable(
  'database_connectors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    databaseId: uuid('database_id')
      .notNull()
      .references(() => databases.id, { onDelete: 'cascade' }),
    /** Adapter kind — 'google_sheets' | 'airtable' | 'csv' (closed enum at the lib layer). */
    kind: text('kind').notNull(),
    /** Always stored encrypted via src/lib/connectors/auth.ts (secret-box envelope). */
    authConfig: bytea('auth_config').notNull(),
    /** Adapter-specific mapping (spreadsheetId, column map, poll interval, …). */
    syncConfig: jsonb('sync_config').$type<Record<string, unknown>>().notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    oneConnectorPerDatabase: uniqueIndex('database_connectors_database_id_unique').on(t.databaseId),
  }),
);

export type DatabaseConnector = typeof databaseConnectors.$inferSelect;
export type NewDatabaseConnector = typeof databaseConnectors.$inferInsert;

/** Closed enum for adapter kinds — the schema column itself is `text` for migration ease. */
export type ConnectorKind = 'google_sheets' | 'airtable' | 'csv';
