import { createHash } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { logger } from '@/lib/observability/logger';
import type { AckedChange, ConnectorState, Diff, ExternalRow } from './adapter';
import { decryptAuthConfig } from './auth';
import { getAdapter } from './registry';

function hashCell(v: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(v ?? null))
    .digest('hex');
}

function hashCells(cells: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cells)) out[k] = hashCell(v);
  return out;
}

type CairnRowSnapshot = { rowId: string; cells: Record<string, unknown> };

async function loadCairnRows(databaseId: string): Promise<CairnRowSnapshot[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.dbRows)
    .where(eq(schema.dbRows.databaseId, databaseId));
  if (rows.length === 0) return [];
  const cells = await db
    .select()
    .from(schema.dbCells)
    .where(
      inArray(
        schema.dbCells.rowId,
        rows.map((r) => r.id),
      ),
    );
  const byRow = new Map<string, Record<string, unknown>>();
  for (const r of rows) byRow.set(r.id, {});
  for (const c of cells) {
    const m = byRow.get(c.rowId);
    if (m) m[c.propertyId] = c.value;
  }
  return rows.map((r) => ({ rowId: r.id, cells: byRow.get(r.id) ?? {} }));
}

/**
 * Pick a `created_by` user for rows the engine inserts on behalf of an external
 * system. Prefers the connector's own `createdBy`; falls back to the oldest
 * workspace member (sentinel for self-healing if the original creator was
 * deleted). Throws if the workspace has no members — shouldn't happen in
 * production because workspaces always have at least one member.
 */
async function pickInsertActor(connector: schema.DatabaseConnector): Promise<string> {
  if (connector.createdBy) return connector.createdBy;
  const db = getDb();
  const [member] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, connector.workspaceId))
    .orderBy(asc(schema.workspaceMembers.joinedAt))
    .limit(1);
  if (!member) throw new Error(`connector ${connector.id}: workspace has no members`);
  return member.userId;
}

/**
 * One-shot sync for a single connector. Loads adapter, fetches external rows,
 * diffs against Cairn state via `connector_row_map`, classifies per-cell into
 * (only-Cairn / only-external / both-changed / unchanged), pushes the diff,
 * applies external changes locally, and writes conflict rows for both-changed.
 *
 * P19 ships a single-instance ceiling: running this twice on the same connector
 * concurrently will double-push and possibly double-create. Operators run it
 * via the cron table (G5 P14) which serialises by host.
 */
export async function syncConnector(connectorId: string): Promise<void> {
  const db = getDb();
  const [connector] = await db
    .select()
    .from(schema.databaseConnectors)
    .where(eq(schema.databaseConnectors.id, connectorId))
    .limit(1);
  if (!connector) throw new Error(`connector ${connectorId} not found`);
  if (!connector.enabled) {
    logger.info({ connectorId }, '[connectors] skipped (disabled)');
    return;
  }

  const adapter = getAdapter(connector.kind as schema.ConnectorKind);
  const state: ConnectorState = {
    connectorId: connector.id,
    workspaceId: connector.workspaceId,
    authConfig: decryptAuthConfig(connector.authConfig),
    syncConfig: connector.syncConfig,
  };

  const externalRows: ExternalRow[] = await adapter.fetchAll(state);
  const cairnRows = await loadCairnRows(connector.databaseId);
  const maps = await db
    .select()
    .from(schema.connectorRowMap)
    .where(eq(schema.connectorRowMap.connectorId, connector.id));

  const mapByCairn = new Map(maps.map((m) => [m.cairnRowId, m] as const));
  const mapByExternal = new Map(maps.map((m) => [m.externalId, m] as const));

  const diff: Diff = { creates: [], updates: [], deletes: [] };
  const conflictsToWrite: schema.NewConnectorConflict[] = [];
  const cellApplies: Array<{ rowId: string; cells: Record<string, unknown> }> = [];
  const rowMapUpdates: Array<{ id: string; cellHashes: Record<string, string> }> = [];

  // Pass 1: external rows we know about — classify by hash deltas.
  for (const ext of externalRows) {
    const map = mapByExternal.get(ext.externalId);
    if (!map) continue; // handled in pass 3 (unknown-external creates).
    const cairn = cairnRows.find((r) => r.rowId === map.cairnRowId);
    if (!cairn) continue;
    const baseline = map.cellHashes ?? {};
    const cairnHashes = hashCells(cairn.cells);
    const externalHashes = hashCells(ext.cells);

    const allProps = new Set([
      ...Object.keys(baseline),
      ...Object.keys(cairnHashes),
      ...Object.keys(externalHashes),
    ]);
    const externalChange: Record<string, unknown> = {};

    for (const prop of allProps) {
      const b = baseline[prop] ?? hashCell(undefined);
      const c = cairnHashes[prop] ?? hashCell(undefined);
      const e = externalHashes[prop] ?? hashCell(undefined);
      const cairnDiffers = c !== b;
      const externalDiffers = e !== b;

      if (cairnDiffers && externalDiffers) {
        conflictsToWrite.push({
          connectorId: connector.id,
          rowId: map.cairnRowId,
          propertyId: prop,
          cairnValue: cairn.cells[prop] ?? null,
          externalValue: ext.cells[prop] ?? null,
          cairnTs: new Date(),
          externalTs: ext.modifiedAt ?? new Date(),
        });
      } else if (cairnDiffers) {
        externalChange[prop] = cairn.cells[prop];
      } else if (externalDiffers) {
        cellApplies.push({ rowId: map.cairnRowId, cells: { [prop]: ext.cells[prop] } });
      }
    }

    if (Object.keys(externalChange).length > 0) {
      diff.updates.push({ externalId: ext.externalId, cells: externalChange });
    }
  }

  // Pass 2: Cairn rows with no map entry — create on external.
  for (const cairn of cairnRows) {
    if (mapByCairn.has(cairn.rowId)) continue;
    diff.creates.push({ cairnRowId: cairn.rowId, cells: cairn.cells });
  }

  // Pass 3: external rows with no map entry — create on Cairn.
  const unknownExternals = externalRows.filter((e) => !mapByExternal.has(e.externalId));
  if (unknownExternals.length > 0) {
    const actorUserId = await pickInsertActor(connector);
    for (const ext of unknownExternals) {
      const [newRow] = await db
        .insert(schema.dbRows)
        .values({ databaseId: connector.databaseId, createdBy: actorUserId })
        .returning();
      if (!newRow) throw new Error('[connectors] db_rows insert returned no row');
      for (const [prop, val] of Object.entries(ext.cells)) {
        await db.insert(schema.dbCells).values({ rowId: newRow.id, propertyId: prop, value: val });
      }
      await db.insert(schema.connectorRowMap).values({
        connectorId: connector.id,
        cairnRowId: newRow.id,
        externalId: ext.externalId,
        cellHashes: hashCells(ext.cells),
      });
    }
  }

  // Apply external → Cairn cell updates (composite-PK upsert per cell).
  for (const apply of cellApplies) {
    for (const [prop, val] of Object.entries(apply.cells)) {
      await db
        .insert(schema.dbCells)
        .values({ rowId: apply.rowId, propertyId: prop, value: val })
        .onConflictDoUpdate({
          target: [schema.dbCells.rowId, schema.dbCells.propertyId],
          set: { value: val },
        });
    }
    const m = maps.find((x) => x.cairnRowId === apply.rowId);
    if (m) {
      // Re-hash from external (since Cairn now matches external).
      rowMapUpdates.push({
        id: m.id,
        cellHashes: { ...m.cellHashes, ...hashCells(apply.cells) },
      });
    }
  }

  // Push the diff to the external system.
  let acks: AckedChange[] = [];
  if (diff.creates.length + diff.updates.length + diff.deletes.length > 0) {
    const result = await adapter.applyChanges(state, diff);
    acks = result.acks;
  }

  // Record fresh row-map entries from create acks, and refresh cell hashes for updates.
  for (const ack of acks) {
    if (ack.kind === 'create') {
      const cairnRow = cairnRows.find((r) => r.rowId === ack.cairnRowId);
      await db.insert(schema.connectorRowMap).values({
        connectorId: connector.id,
        cairnRowId: ack.cairnRowId,
        externalId: ack.externalId,
        cellHashes: hashCells(cairnRow?.cells ?? {}),
      });
    } else if (ack.kind === 'update') {
      const m = maps.find((x) => x.externalId === ack.externalId);
      const cairn = cairnRows.find((r) => r.rowId === m?.cairnRowId);
      if (m && cairn) {
        rowMapUpdates.push({ id: m.id, cellHashes: hashCells(cairn.cells) });
      }
    }
  }

  for (const u of rowMapUpdates) {
    await db
      .update(schema.connectorRowMap)
      .set({ cellHashes: u.cellHashes, lastSyncedAt: new Date() })
      .where(eq(schema.connectorRowMap.id, u.id));
  }

  if (conflictsToWrite.length > 0) {
    await db.insert(schema.connectorConflicts).values(conflictsToWrite);
  }

  await db
    .update(schema.databaseConnectors)
    .set({ lastSyncedAt: new Date() })
    .where(eq(schema.databaseConnectors.id, connector.id));
}
