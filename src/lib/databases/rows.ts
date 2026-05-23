import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { observeDb } from '@/lib/observability/metrics';
import { emit } from '@/lib/webhooks/dispatch';
import { compileFilters, type FilterCondition } from './filter';
import { computeFormula, type FormulaContext } from './formula';
import { validateParent } from './hierarchy';
import { resolveRelationCells, syncRelationCells, validateRelationCells } from './relations';
import { resolveRollupCells } from './rollup/resolve';
import { compileSorts, type SortSpec } from './sort';

export type { FilterCondition } from './filter';
export type { SortSpec } from './sort';

export type RowWithCells = { row: schema.DbRow; cells: Record<string, unknown> };

export async function createRow(
  db: PostgresJsDatabase<typeof schema>,
  input: {
    databaseId: string;
    workspaceId: string;
    createdBy: string;
    cells?: Record<string, unknown>;
    parentRowId?: string | null;
  },
): Promise<schema.DbRow> {
  const row = await db.transaction(async (tx) => {
    const [database] = await tx
      .select({ workspaceId: schema.databases.workspaceId })
      .from(schema.databases)
      .where(eq(schema.databases.id, input.databaseId))
      .limit(1);
    if (!database || database.workspaceId !== input.workspaceId) {
      throw new Error('database not found in workspace');
    }
    const [row] = await tx
      .insert(schema.dbRows)
      .values({ databaseId: input.databaseId, createdBy: input.createdBy })
      .returning();
    if (!row) throw new Error('insert row failed');

    if (input.cells) {
      const props = await tx
        .select()
        .from(schema.dbProperties)
        .where(eq(schema.dbProperties.databaseId, input.databaseId));
      const propsById = new Map(props.map((p) => [p.id, p]));
      const cellValues = Object.entries(input.cells)
        .filter(([propId]) => propsById.has(propId))
        .map(([propId, value]) => {
          const prop = propsById.get(propId);
          if (!prop) throw new Error('unreachable');
          return { rowId: row.id, propertyId: propId, value: coerce(prop.type, value) };
        });
      const coercedByProp: Record<string, unknown> = {};
      for (const cv of cellValues) coercedByProp[cv.propertyId] = cv.value;
      await validateRelationCells(tx, props, coercedByProp);
      if (cellValues.length > 0) {
        await tx.insert(schema.dbCells).values(cellValues);
      }
      // Mirror paired (reverse) relations: a new row has no prior cells, so before = {}.
      await syncRelationCells(tx, {
        rowId: row.id,
        props,
        before: {},
        after: coercedByProp,
      });
    }

    if (input.parentRowId !== undefined && input.parentRowId !== null) {
      await validateParent(tx, {
        rowId: row.id,
        databaseId: input.databaseId,
        parentId: input.parentRowId,
      });
      const [updated] = await tx
        .update(schema.dbRows)
        .set({ parentRowId: input.parentRowId })
        .where(eq(schema.dbRows.id, row.id))
        .returning();
      return updated ?? row;
    }
    return row;
  });
  // Fire-and-forget webhook (self-guarding; never throws into the caller).
  void emit('row.created', input.workspaceId, { id: row.id, databaseId: input.databaseId });
  return row;
}

export async function updateCells(
  db: PostgresJsDatabase<typeof schema>,
  input: {
    rowId: string;
    databaseId: string;
    workspaceId: string;
    cells: Record<string, unknown>;
    parentRowId?: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        databaseId: schema.dbRows.databaseId,
        workspaceId: schema.databases.workspaceId,
      })
      .from(schema.dbRows)
      .innerJoin(schema.databases, eq(schema.dbRows.databaseId, schema.databases.id))
      .where(eq(schema.dbRows.id, input.rowId))
      .limit(1);
    if (!row || row.workspaceId !== input.workspaceId || row.databaseId !== input.databaseId) {
      throw new Error('row not found in database');
    }
    const props = await tx
      .select()
      .from(schema.dbProperties)
      .where(eq(schema.dbProperties.databaseId, input.databaseId));
    const propsById = new Map(props.map((p) => [p.id, p]));

    // Capture prior relation cell values BEFORE writing, so the reverse-sync diff is correct.
    const relationPropIdsInWrite = Object.keys(input.cells).filter(
      (propId) => propsById.get(propId)?.type === 'relation',
    );
    const before: Record<string, unknown> = {};
    if (relationPropIdsInWrite.length > 0) {
      const prior = await tx
        .select({ propertyId: schema.dbCells.propertyId, value: schema.dbCells.value })
        .from(schema.dbCells)
        .where(
          and(
            eq(schema.dbCells.rowId, input.rowId),
            inArray(schema.dbCells.propertyId, relationPropIdsInWrite),
          ),
        );
      for (const c of prior) before[c.propertyId] = c.value;
    }

    const coercedByProp: Record<string, unknown> = {};
    for (const [propId, raw] of Object.entries(input.cells)) {
      const prop = propsById.get(propId);
      if (!prop) continue;
      const value = coerce(prop.type, raw);
      coercedByProp[propId] = value;
      await tx
        .insert(schema.dbCells)
        .values({ rowId: input.rowId, propertyId: propId, value })
        .onConflictDoUpdate({
          target: [schema.dbCells.rowId, schema.dbCells.propertyId],
          set: { value },
        });
    }
    await validateRelationCells(tx, props, coercedByProp);
    // Mirror paired (reverse) relations: diff before -> after for relation props in this write.
    await syncRelationCells(tx, { rowId: input.rowId, props, before, after: coercedByProp });
    if (input.parentRowId !== undefined) {
      await validateParent(tx, {
        rowId: input.rowId,
        databaseId: input.databaseId,
        parentId: input.parentRowId,
      });
      await tx
        .update(schema.dbRows)
        .set({ parentRowId: input.parentRowId })
        .where(eq(schema.dbRows.id, input.rowId));
    }
    await tx
      .update(schema.dbRows)
      .set({ updatedAt: new Date() })
      .where(eq(schema.dbRows.id, input.rowId));
  });
  // Fire-and-forget webhook (self-guarding; never throws into the caller).
  void emit('row.updated', input.workspaceId, { id: input.rowId, databaseId: input.databaseId });
}

export function coerce(type: schema.PropertyType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      return Boolean(value);
    case 'date': {
      if (typeof value === 'string') {
        const d = new Date(value);
        return Number.isFinite(d.getTime()) ? d.toISOString() : null;
      }
      return null;
    }
    case 'multi_select':
      return Array.isArray(value) ? value.map(String) : [];
    case 'relation': {
      if (!Array.isArray(value)) return [];
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const v of value) {
        if (typeof v !== 'string') continue;
        const t = v.trim();
        if (t === '' || seen.has(t)) continue;
        seen.add(t);
        ids.push(t);
      }
      return ids;
    }
    case 'select':
    case 'text':
    case 'url':
      return typeof value === 'string' ? value : String(value);
  }
}

export async function archiveRow(
  db: PostgresJsDatabase<typeof schema>,
  input: { rowId: string; databaseId: string; workspaceId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        databaseId: schema.dbRows.databaseId,
        workspaceId: schema.databases.workspaceId,
      })
      .from(schema.dbRows)
      .innerJoin(schema.databases, eq(schema.dbRows.databaseId, schema.databases.id))
      .where(eq(schema.dbRows.id, input.rowId))
      .limit(1);
    if (!row || row.workspaceId !== input.workspaceId || row.databaseId !== input.databaseId) {
      throw new Error('row not found');
    }
    await tx
      .update(schema.dbRows)
      .set({ archivedAt: new Date() })
      .where(eq(schema.dbRows.id, input.rowId));
  });
  // Fire-and-forget webhook (self-guarding; never throws into the caller).
  void emit('row.deleted', input.workspaceId, { id: input.rowId, databaseId: input.databaseId });
}

export async function listRows(
  db: PostgresJsDatabase<typeof schema>,
  input: {
    databaseId: string;
    workspaceId: string;
    filters?: FilterCondition[];
    sorts?: SortSpec[];
    limit?: number;
    offset?: number;
  },
): Promise<RowWithCells[]> {
  // Time the entire list-rows path (workspace-scope check + props load + filter/
  // sort + page fetch + cells/relations/rollups/formulas). Single fixed operation
  // label per spec §610 (bounded label set; no table/id/SQL text in labels).
  const __t0 = performance.now();
  try {
    return await listRowsInner(db, input);
  } finally {
    observeDb({ operation: 'list_rows', durationSec: (performance.now() - __t0) / 1000 });
  }
}

async function listRowsInner(
  db: PostgresJsDatabase<typeof schema>,
  input: {
    databaseId: string;
    workspaceId: string;
    filters?: FilterCondition[];
    sorts?: SortSpec[];
    limit?: number;
    offset?: number;
  },
): Promise<RowWithCells[]> {
  const [database] = await db
    .select({ workspaceId: schema.databases.workspaceId })
    .from(schema.databases)
    .where(eq(schema.databases.id, input.databaseId))
    .limit(1);
  if (!database || database.workspaceId !== input.workspaceId) return [];

  const props = await db
    .select()
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.databaseId, input.databaseId));
  const propsById = new Map(props.map((p) => [p.id, p]));

  const filterClause = compileFilters(input.filters ?? [], propsById);
  const sortClause = compileSorts(input.sorts ?? [], propsById);

  const baseWhere = and(
    eq(schema.dbRows.databaseId, input.databaseId),
    isNull(schema.dbRows.archivedAt),
  );
  const where = filterClause ? and(baseWhere, filterClause) : baseWhere;

  const orderBy = sortClause ?? schema.dbRows.createdAt;

  const rows = await db
    .select()
    .from(schema.dbRows)
    .where(where)
    .orderBy(orderBy)
    .limit(input.limit ?? 100)
    .offset(input.offset ?? 0);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const cells = await db.select().from(schema.dbCells).where(inArray(schema.dbCells.rowId, ids));

  const cellsByRow = new Map<string, Record<string, unknown>>();
  for (const c of cells) {
    if (!cellsByRow.has(c.rowId)) cellsByRow.set(c.rowId, {});
    const map = cellsByRow.get(c.rowId);
    if (map) map[c.propertyId] = c.value;
  }
  // Ensure every row has a cells map (so empty relation cells still resolve).
  for (const r of rows) {
    if (!cellsByRow.has(r.id)) cellsByRow.set(r.id, {});
  }

  // Resolve relation cells (to { ids, labels }) BEFORE formulas reference them.
  const relationProps = props.filter((p) => p.type === 'relation');
  await resolveRelationCells(db, relationProps, cellsByRow);

  // Compute rollup cells AFTER relations (rollups read the resolved { ids }).
  const rollupProps = props.filter((p) => p.type === 'rollup');
  await resolveRollupCells(db, rollupProps, cellsByRow);

  // Build name -> id map (shared across rows) and the list of formula properties.
  const nameToId = new Map<string, string>(props.map((p) => [p.name, p.id]));
  const formulaProps = props.filter((p) => p.type === 'formula');

  return rows.map((r) => {
    const cells = cellsByRow.get(r.id) ?? {};
    if (formulaProps.length > 0) {
      for (const fp of formulaProps) {
        const expression =
          typeof fp.config === 'object' && fp.config !== null
            ? (fp.config as { expression?: unknown }).expression
            : undefined;
        if (typeof expression !== 'string' || expression.trim() === '') {
          cells[fp.id] = { __error: 'no formula expression' };
          continue;
        }
        const ctx: FormulaContext = { nameToId, cells };
        cells[fp.id] = computeFormula(expression, ctx);
      }
    }
    return { row: r, cells };
  });
}
