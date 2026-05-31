import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ConnectorKind, DatabaseConnector } from '@/db/schema';
import * as schema from '@/db/schema';
import { encryptAuthConfig } from './auth';

type Db = PostgresJsDatabase<typeof schema>;

export type ConnectorListRow = {
  id: string;
  kind: string;
  databaseId: string;
  databaseName: string;
  enabled: boolean;
  lastSyncedAt: Date | null;
  unresolvedConflicts: number;
};

export type ConnectorConfigProperty = { id: string; name: string; type: string };

export type ConnectorConfigView = {
  connector: DatabaseConnector;
  properties: ConnectorConfigProperty[];
};

/** Insert a new, disabled connector with an empty (but encrypted) auth envelope. */
export async function createConnector(
  db: Db,
  input: { workspaceId: string; databaseId: string; kind: ConnectorKind; createdBy: string },
): Promise<DatabaseConnector> {
  const [row] = await db
    .insert(schema.databaseConnectors)
    .values({
      workspaceId: input.workspaceId,
      databaseId: input.databaseId,
      kind: input.kind,
      authConfig: encryptAuthConfig({}),
      syncConfig: {},
      enabled: false,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error('connector insert failed');
  return row;
}

/** Every connector in the workspace, joined to its database name + unresolved conflict count. */
export async function listConnectors(db: Db, workspaceId: string): Promise<ConnectorListRow[]> {
  return db
    .select({
      id: schema.databaseConnectors.id,
      kind: schema.databaseConnectors.kind,
      databaseId: schema.databaseConnectors.databaseId,
      databaseName: schema.databases.name,
      enabled: schema.databaseConnectors.enabled,
      lastSyncedAt: schema.databaseConnectors.lastSyncedAt,
      unresolvedConflicts: sql<number>`(
        select count(*)::int from ${schema.connectorConflicts}
        where ${schema.connectorConflicts.connectorId} = ${schema.databaseConnectors.id}
          and ${schema.connectorConflicts.resolvedAt} is null
      )`,
    })
    .from(schema.databaseConnectors)
    .innerJoin(schema.databases, eq(schema.databaseConnectors.databaseId, schema.databases.id))
    .where(eq(schema.databaseConnectors.workspaceId, workspaceId));
}

/** Resolve a connector (workspace-scoped) and its target database's properties. */
export async function getConnectorForConfig(
  db: Db,
  connectorId: string,
  workspaceId: string,
): Promise<ConnectorConfigView | null> {
  const [connector] = await db
    .select()
    .from(schema.databaseConnectors)
    .where(
      and(
        eq(schema.databaseConnectors.id, connectorId),
        eq(schema.databaseConnectors.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!connector) return null;
  const properties = await db
    .select({
      id: schema.dbProperties.id,
      name: schema.dbProperties.name,
      type: schema.dbProperties.type,
    })
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.databaseId, connector.databaseId))
    .orderBy(schema.dbProperties.position);
  return { connector, properties };
}

/** Apply a config PATCH. Encrypt authConfig only when present; merge sync; set enabled. */
export async function updateConnectorConfig(
  db: Db,
  connectorId: string,
  workspaceId: string,
  patch: {
    syncConfig: Record<string, unknown>;
    authConfig?: Record<string, unknown>;
    enabled?: boolean;
  },
): Promise<DatabaseConnector | null> {
  const set: Partial<typeof schema.databaseConnectors.$inferInsert> = {
    syncConfig: patch.syncConfig,
  };
  if (patch.authConfig !== undefined) set.authConfig = encryptAuthConfig(patch.authConfig);
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  const [row] = await db
    .update(schema.databaseConnectors)
    .set(set)
    .where(
      and(
        eq(schema.databaseConnectors.id, connectorId),
        eq(schema.databaseConnectors.workspaceId, workspaceId),
      ),
    )
    .returning();
  return row ?? null;
}

/** Delete a connector (workspace-scoped). Conflicts + row-map cascade via FK (onDelete: cascade). */
export async function deleteConnector(
  db: Db,
  connectorId: string,
  workspaceId: string,
): Promise<boolean> {
  const rows = await db
    .delete(schema.databaseConnectors)
    .where(
      and(
        eq(schema.databaseConnectors.id, connectorId),
        eq(schema.databaseConnectors.workspaceId, workspaceId),
      ),
    )
    .returning({ id: schema.databaseConnectors.id });
  return rows.length > 0;
}
