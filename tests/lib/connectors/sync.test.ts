import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import type { ConnectorAdapter, ConnectorState, ExternalRow } from '@/lib/connectors/adapter';
import { encryptAuthConfig } from '@/lib/connectors/auth';
import { __resetRegistry, register } from '@/lib/connectors/registry';
import { syncConnector } from '@/lib/connectors/sync';
import { startPostgres, stopPostgres } from '../../helpers/db';

// MemoryAdapter piggybacks on 'csv' kind. P22 ships the real CSV adapter; for
// P19 the registry is reset per-test so this stub owns 'csv' exclusively.
const TEST_KIND = 'csv' as schema.ConnectorKind;

class MemoryAdapter implements ConnectorAdapter {
  kind = TEST_KIND;
  // Unused in P19; concrete adapters in P20+ validate plaintext auth shapes.
  authConfigSchema = { parse: (v: unknown) => v } as never;
  rows: ExternalRow[] = [];
  applyCalls: Array<Parameters<ConnectorAdapter['applyChanges']>[1]> = [];

  async fetchAll(_state: ConnectorState): Promise<ExternalRow[]> {
    return JSON.parse(JSON.stringify(this.rows));
  }

  async applyChanges(
    _state: ConnectorState,
    diff: Parameters<ConnectorAdapter['applyChanges']>[1],
  ) {
    this.applyCalls.push(diff);
    const acks: Awaited<ReturnType<ConnectorAdapter['applyChanges']>>['acks'] = [];
    for (const c of diff.creates) {
      const externalId = `ext_${this.rows.length + 1}`;
      this.rows.push({ externalId, cells: c.cells });
      acks.push({ kind: 'create', cairnRowId: c.cairnRowId, externalId });
    }
    for (const u of diff.updates) {
      const r = this.rows.find((x) => x.externalId === u.externalId);
      if (r) r.cells = { ...r.cells, ...u.cells };
      acks.push({ kind: 'update', externalId: u.externalId });
    }
    return { acks };
  }
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let adapter: MemoryAdapter;
let workspaceId: string;
let userId: string;
let databaseId: string;
let propertyId: string;
let connectorId: string;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  // AUTH_SECRET is required by env() (used inside auth.ts). Set a fixed test value
  // — long enough for the min(32) zod check — so encryptAuthConfig works.
  process.env.AUTH_SECRET ??= 'test-auth-secret-thirty-two-chars-min-aaaaaa';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE connector_conflicts, connector_row_map, database_connectors, db_cells, db_rows, db_properties, db_views, databases, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  __resetRegistry();
  adapter = new MemoryAdapter();
  register(adapter);

  const [u] = await db
    .insert(schema.users)
    .values({ email: 'a@b.c', passwordHash: 'h', name: 'A' })
    .returning();
  if (!u) throw new Error('user insert failed');
  userId = u.id;
  const [w] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w' }).returning();
  if (!w) throw new Error('workspace insert failed');
  workspaceId = w.id;
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', createdBy: userId })
    .returning();
  if (!page) throw new Error('page insert failed');
  const [d] = await db
    .insert(schema.databases)
    .values({ workspaceId, pageId: page.id, name: 'D', createdBy: userId })
    .returning();
  if (!d) throw new Error('database insert failed');
  databaseId = d.id;
  const [p] = await db
    .insert(schema.dbProperties)
    .values({ databaseId, name: 'Status', type: 'text', position: 0 })
    .returning();
  if (!p) throw new Error('property insert failed');
  propertyId = p.id;

  const [c] = await db
    .insert(schema.databaseConnectors)
    .values({
      workspaceId,
      databaseId,
      kind: TEST_KIND,
      authConfig: encryptAuthConfig({ token: 'placeholder' }),
      syncConfig: { mapping: { [propertyId]: 'status' } },
      createdBy: userId,
    })
    .returning();
  if (!c) throw new Error('connector insert failed');
  connectorId = c.id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncConnector', () => {
  it('push-only-Cairn-changed: writes the diff via applyChanges', async () => {
    const [r] = await db
      .insert(schema.dbRows)
      .values({ databaseId, createdBy: userId })
      .returning();
    if (!r) throw new Error('row insert failed');
    await db.insert(schema.dbCells).values({ rowId: r.id, propertyId, value: 'Done' });

    await syncConnector(connectorId);

    expect(adapter.rows).toHaveLength(1);
    expect(adapter.rows[0]?.cells[propertyId]).toBe('Done');
    const map = await db
      .select()
      .from(schema.connectorRowMap)
      .where(eq(schema.connectorRowMap.connectorId, connectorId));
    expect(map).toHaveLength(1);
    expect(map[0]?.cairnRowId).toBe(r.id);
  });

  it('push-only-external-changed: applies external changes to Cairn', async () => {
    const [r] = await db
      .insert(schema.dbRows)
      .values({ databaseId, createdBy: userId })
      .returning();
    if (!r) throw new Error('row insert failed');
    await db.insert(schema.dbCells).values({ rowId: r.id, propertyId, value: 'Open' });
    // Seed the row map as if a prior sync had matched these.
    await db.insert(schema.connectorRowMap).values({
      connectorId,
      cairnRowId: r.id,
      externalId: 'ext_1',
      cellHashes: { [propertyId]: hashOf('Open') },
    });
    adapter.rows = [{ externalId: 'ext_1', cells: { [propertyId]: 'Closed' } }];

    await syncConnector(connectorId);

    const cells = await db.select().from(schema.dbCells).where(eq(schema.dbCells.rowId, r.id));
    expect(cells[0]?.value).toBe('Closed');
    expect(adapter.applyCalls.every((d) => d.updates.length === 0 && d.creates.length === 0)).toBe(
      true,
    );
  });

  it('both-changed: writes a connector_conflicts row, leaves both sides alone', async () => {
    const [r] = await db
      .insert(schema.dbRows)
      .values({ databaseId, createdBy: userId })
      .returning();
    if (!r) throw new Error('row insert failed');
    await db.insert(schema.dbCells).values({ rowId: r.id, propertyId, value: 'Cairn-changed' });
    await db.insert(schema.connectorRowMap).values({
      connectorId,
      cairnRowId: r.id,
      externalId: 'ext_1',
      cellHashes: { [propertyId]: hashOf('original') },
    });
    adapter.rows = [{ externalId: 'ext_1', cells: { [propertyId]: 'External-changed' } }];

    await syncConnector(connectorId);

    const conflicts = await db
      .select()
      .from(schema.connectorConflicts)
      .where(eq(schema.connectorConflicts.connectorId, connectorId));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.cairnValue).toBe('Cairn-changed');
    expect(conflicts[0]?.externalValue).toBe('External-changed');
    // Neither side mutated.
    const cell = await db.select().from(schema.dbCells).where(eq(schema.dbCells.rowId, r.id));
    expect(cell[0]?.value).toBe('Cairn-changed');
    expect(adapter.rows[0]?.cells[propertyId]).toBe('External-changed');
  });

  it('respects the enabled flag — disabled connector is a no-op', async () => {
    await db
      .update(schema.databaseConnectors)
      .set({ enabled: false })
      .where(eq(schema.databaseConnectors.id, connectorId));
    const [r] = await db
      .insert(schema.dbRows)
      .values({ databaseId, createdBy: userId })
      .returning();
    if (!r) throw new Error('row insert failed');
    await db.insert(schema.dbCells).values({ rowId: r.id, propertyId, value: 'X' });

    await syncConnector(connectorId);

    expect(adapter.rows).toHaveLength(0);
    const map = await db.select().from(schema.connectorRowMap);
    expect(map).toHaveLength(0);
  });

  it('creates new Cairn rows when external rows have no map entry', async () => {
    adapter.rows = [{ externalId: 'ext_99', cells: { [propertyId]: 'FromExternal' } }];

    await syncConnector(connectorId);

    const rows = await db
      .select()
      .from(schema.dbRows)
      .where(eq(schema.dbRows.databaseId, databaseId));
    expect(rows).toHaveLength(1);
    const newRowId = rows[0]?.id;
    expect(newRowId).toBeTruthy();
    const cells = await db.select().from(schema.dbCells);
    expect(cells.find((c) => c.rowId === newRowId)?.value).toBe('FromExternal');
    const map = await db
      .select()
      .from(schema.connectorRowMap)
      .where(
        and(
          eq(schema.connectorRowMap.connectorId, connectorId),
          eq(schema.connectorRowMap.externalId, 'ext_99'),
        ),
      );
    expect(map).toHaveLength(1);
  });
});

// Match the hash function used by sync.ts (canonical-JSON sha256).
function hashOf(v: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(v ?? null))
    .digest('hex');
}
