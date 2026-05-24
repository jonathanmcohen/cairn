import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { databaseConnectors } from './database-connectors';
import { dbProperties, dbRows } from './databases';

/**
 * Captured when the sync engine sees both sides of a cell change since the
 * last sync. The user resolves via /api/connectors/[id]/conflicts/[id]/resolve
 * (Cairn / external / manual). Foreign keys SET NULL on row/property delete
 * so the audit trail survives a database row deletion.
 */
export const connectorConflicts = pgTable('connector_conflicts', {
  id: uuid('id').primaryKey().defaultRandom(),
  connectorId: uuid('connector_id')
    .notNull()
    .references(() => databaseConnectors.id, { onDelete: 'cascade' }),
  rowId: uuid('row_id').references(() => dbRows.id, { onDelete: 'set null' }),
  propertyId: uuid('property_id').references(() => dbProperties.id, { onDelete: 'set null' }),
  cairnValue: jsonb('cairn_value').$type<unknown>(),
  externalValue: jsonb('external_value').$type<unknown>(),
  cairnTs: timestamp('cairn_ts', { withTimezone: true }).notNull(),
  externalTs: timestamp('external_ts', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  /** 'cairn' | 'external' | 'manual' — set once resolved. */
  resolution: text('resolution'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ConnectorConflict = typeof connectorConflicts.$inferSelect;
export type NewConnectorConflict = typeof connectorConflicts.$inferInsert;
export type ConflictResolution = 'cairn' | 'external' | 'manual';
