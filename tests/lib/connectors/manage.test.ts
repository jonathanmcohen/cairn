import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { decryptAuthConfig } from '@/lib/connectors/auth';
import {
  createConnector,
  deleteConnector,
  getConnectorForConfig,
  listConnectors,
  updateConnectorConfig,
} from '@/lib/connectors/manage';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE connector_conflicts, connector_row_map, database_connectors, db_cells, db_rows, db_properties, db_views, databases, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seed() {
  const [u] = await db
    .insert(schema.users)
    .values({ email: `a${Math.random()}@b.c`, name: 'A', passwordHash: 'x' })
    .returning();
  if (!u) throw new Error('user');
  const [w] = await db
    .insert(schema.workspaces)
    .values({ name: 'W', slug: `ws-${u.id}` })
    .returning();
  if (!w) throw new Error('workspace');
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId: w.id, title: 'P', createdBy: u.id })
    .returning();
  if (!page) throw new Error('page');
  const [database] = await db
    .insert(schema.databases)
    .values({ workspaceId: w.id, pageId: page.id, name: 'Projects', createdBy: u.id })
    .returning();
  if (!database) throw new Error('database');
  const [prop] = await db
    .insert(schema.dbProperties)
    .values({ databaseId: database.id, name: 'Name', type: 'text', position: 0 })
    .returning();
  if (!prop) throw new Error('prop');
  return { userId: u.id, workspaceId: w.id, databaseId: database.id, propertyId: prop.id };
}

describe('connector manage helpers', () => {
  it('createConnector inserts a disabled row with empty sync config + encrypted empty auth', async () => {
    const { userId, workspaceId, databaseId } = await seed();
    const conn = await createConnector(db, {
      workspaceId,
      databaseId,
      kind: 'csv',
      createdBy: userId,
    });
    expect(conn.kind).toBe('csv');
    expect(conn.enabled).toBe(false);
    expect(conn.syncConfig).toEqual({});
    expect(decryptAuthConfig(conn.authConfig)).toEqual({});
  });

  it('listConnectors returns only the workspace rows with unresolved-conflict counts + db name', async () => {
    const { userId, workspaceId, databaseId } = await seed();
    const conn = await createConnector(db, {
      workspaceId,
      databaseId,
      kind: 'airtable',
      createdBy: userId,
    });
    await db.insert(schema.connectorConflicts).values({
      connectorId: conn.id,
      cairnTs: new Date(),
      externalTs: new Date(),
    });
    await db.insert(schema.connectorConflicts).values({
      connectorId: conn.id,
      cairnTs: new Date(),
      externalTs: new Date(),
      resolvedAt: new Date(),
    });
    const rows = await listConnectors(db, workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('airtable');
    expect(rows[0]?.databaseName).toBe('Projects');
    expect(rows[0]?.unresolvedConflicts).toBe(1);
  });

  it('updateConnectorConfig merges syncConfig, encrypts authConfig only when given, sets enabled', async () => {
    const { userId, workspaceId, databaseId } = await seed();
    const conn = await createConnector(db, {
      workspaceId,
      databaseId,
      kind: 'airtable',
      createdBy: userId,
    });
    await updateConnectorConfig(db, conn.id, workspaceId, {
      syncConfig: { baseId: 'appX', tableId: 'tblY' },
      authConfig: { pat: 'patSECRET' },
      enabled: true,
    });
    const view = await getConnectorForConfig(db, conn.id, workspaceId);
    expect(view?.connector.syncConfig).toEqual({ baseId: 'appX', tableId: 'tblY' });
    expect(view?.connector.enabled).toBe(true);
    expect(decryptAuthConfig(view!.connector.authConfig)).toEqual({ pat: 'patSECRET' });
  });

  it('updateConnectorConfig leaves the encrypted auth envelope untouched when authConfig is omitted', async () => {
    const { userId, workspaceId, databaseId } = await seed();
    const conn = await createConnector(db, {
      workspaceId,
      databaseId,
      kind: 'csv',
      createdBy: userId,
    });
    await updateConnectorConfig(db, conn.id, workspaceId, {
      syncConfig: { relativePath: 'x.csv' },
      enabled: true,
    });
    const view = await getConnectorForConfig(db, conn.id, workspaceId);
    expect(decryptAuthConfig(view!.connector.authConfig)).toEqual({});
  });

  it('getConnectorForConfig returns the connector + its database properties', async () => {
    const { userId, workspaceId, databaseId } = await seed();
    const conn = await createConnector(db, {
      workspaceId,
      databaseId,
      kind: 'csv',
      createdBy: userId,
    });
    const view = await getConnectorForConfig(db, conn.id, workspaceId);
    expect(view?.properties.map((p) => p.name)).toEqual(['Name']);
  });

  it('getConnectorForConfig returns null for a connector in another workspace', async () => {
    const a = await seed();
    const b = await seed();
    const conn = await createConnector(db, {
      workspaceId: a.workspaceId,
      databaseId: a.databaseId,
      kind: 'csv',
      createdBy: a.userId,
    });
    expect(await getConnectorForConfig(db, conn.id, b.workspaceId)).toBeNull();
    expect(await getConnectorForConfig(db, conn.id, a.workspaceId)).not.toBeNull();
  });

  it('deleteConnector removes a workspace connector and cascades its conflicts', async () => {
    const { userId, workspaceId, databaseId } = await seed();
    const conn = await createConnector(db, {
      workspaceId,
      databaseId,
      kind: 'csv',
      createdBy: userId,
    });
    await db.insert(schema.connectorConflicts).values({
      connectorId: conn.id,
      cairnTs: new Date(),
      externalTs: new Date(),
    });
    expect(await deleteConnector(db, conn.id, workspaceId)).toBe(true);
    const remaining = await db
      .select()
      .from(schema.databaseConnectors)
      .where(eq(schema.databaseConnectors.id, conn.id));
    expect(remaining).toHaveLength(0);
    const conflicts = await db
      .select()
      .from(schema.connectorConflicts)
      .where(eq(schema.connectorConflicts.connectorId, conn.id));
    expect(conflicts).toHaveLength(0);
  });

  it('deleteConnector returns false for a connector outside the workspace', async () => {
    const a = await seed();
    const b = await seed();
    const conn = await createConnector(db, {
      workspaceId: a.workspaceId,
      databaseId: a.databaseId,
      kind: 'csv',
      createdBy: a.userId,
    });
    expect(await deleteConnector(db, conn.id, b.workspaceId)).toBe(false);
  });
});
