import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { databaseConnectors } from './database-connectors';
import { dbRows } from './databases';

/**
 * Stable mapping between a Cairn db_row and the adapter's external row id.
 * `cell_hashes` is a per-property sha256(JSON(value)) snapshot taken at the
 * last sync — the LWW engine compares this against current Cairn + external
 * hashes to classify each cell as (only-Cairn-changed / only-external-changed
 * / both-changed / unchanged).
 */
export const connectorRowMap = pgTable(
  'connector_row_map',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => databaseConnectors.id, { onDelete: 'cascade' }),
    cairnRowId: uuid('cairn_row_id')
      .notNull()
      .references(() => dbRows.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
    /** Per-property content hash. Keys are db_properties.id; values are sha256(JSON(value)) hex. */
    cellHashes: jsonb('cell_hashes').$type<Record<string, string>>().notNull().default({}),
  },
  (t) => ({
    byExternal: uniqueIndex('connector_row_map_connector_external_unique').on(
      t.connectorId,
      t.externalId,
    ),
    byCairnRow: uniqueIndex('connector_row_map_connector_row_unique').on(
      t.connectorId,
      t.cairnRowId,
    ),
  }),
);

export type ConnectorRowMap = typeof connectorRowMap.$inferSelect;
export type NewConnectorRowMap = typeof connectorRowMap.$inferInsert;
