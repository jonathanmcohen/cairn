import { and, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '@/db/schema';

/** A relation property points at exactly one target database (same workspace, validated separately). */
export const RelationConfig = z.object({
  targetDatabaseId: z.uuid(),
});

export type RelationConfig = z.infer<typeof RelationConfig>;

/** A relation cell value is a list of related db_rows ids. */
export const RelationCellValue = z.array(z.uuid());

/** Read a property's targetDatabaseId, or undefined if the config is malformed. */
export function relationTargetId(config: unknown): string | undefined {
  const parsed = RelationConfig.safeParse(config);
  return parsed.success ? parsed.data.targetDatabaseId : undefined;
}

/**
 * Validate that every relation cell's ids resolve to a live (non-archived) row in
 * that property's target database. Batched: a single SELECT across all referenced ids.
 * Throws on any id that does not resolve or belongs to another database.
 * `cells` holds ALREADY-COERCED values (relation cells are string[]).
 */
export async function validateRelationCells(
  tx: PostgresJsDatabase<typeof schema>,
  props: Pick<schema.DbProperty, 'id' | 'type' | 'config'>[],
  cells: Record<string, unknown>,
): Promise<void> {
  // propertyId -> expected target databaseId, for relation props present in this write
  const relTargets = new Map<string, string>();
  const allIds = new Set<string>();
  for (const p of props) {
    if (p.type !== 'relation') continue;
    const value = cells[p.id];
    if (!Array.isArray(value) || value.length === 0) continue;
    const targetId = relationTargetId(p.config);
    if (!targetId) throw new Error(`relation property ${p.id} has no target database`);
    relTargets.set(p.id, targetId);
    for (const id of value as string[]) allIds.add(id);
  }
  if (allIds.size === 0) return;

  const found = await tx
    .select({ id: schema.dbRows.id, databaseId: schema.dbRows.databaseId })
    .from(schema.dbRows)
    .where(and(inArray(schema.dbRows.id, [...allIds]), isNull(schema.dbRows.archivedAt)));
  const dbById = new Map(found.map((r) => [r.id, r.databaseId]));

  for (const [propId, targetId] of relTargets) {
    for (const id of cells[propId] as string[]) {
      const owner = dbById.get(id);
      if (owner === undefined) {
        throw new Error(`relation id ${id} does not resolve to a live row`);
      }
      if (owner !== targetId) {
        throw new Error(`relation id ${id} belongs to a different database`);
      }
    }
  }
}

export type ResolvedRelation = { ids: string[]; labels: string[] };

/**
 * Resolve relation cells across many rows in ONE batched pass.
 * - Collects every referenced related-row id from every relation cell.
 * - One query for live (non-archived) target rows; one query for their label cells.
 * - Filters out dangling ids (rows that no longer resolve).
 * Returns a resolver to apply per-cell. Label = the related row's first text-ish
 * property value (by property position), else "Untitled".
 */
export async function resolveRelationCells(
  db: PostgresJsDatabase<typeof schema>,
  relationProps: Pick<schema.DbProperty, 'id' | 'config'>[],
  cellsByRow: Map<string, Record<string, unknown>>,
): Promise<void> {
  if (relationProps.length === 0) return;
  const relPropIds = new Set(relationProps.map((p) => p.id));

  // 1. Gather every referenced related-row id.
  const allIds = new Set<string>();
  for (const cells of cellsByRow.values()) {
    for (const pid of relPropIds) {
      const v = cells[pid];
      if (Array.isArray(v)) for (const id of v as string[]) allIds.add(id);
    }
  }
  if (allIds.size === 0) {
    // Still normalize empty relation cells to the resolved shape.
    for (const cells of cellsByRow.values()) {
      for (const pid of relPropIds) {
        if (Array.isArray(cells[pid])) cells[pid] = { ids: [], labels: [] };
      }
    }
    return;
  }

  // 2. One query: which of those ids are live rows + their database.
  const liveRows = await db
    .select({ id: schema.dbRows.id, databaseId: schema.dbRows.databaseId })
    .from(schema.dbRows)
    .where(and(inArray(schema.dbRows.id, [...allIds]), isNull(schema.dbRows.archivedAt)));
  const liveById = new Map(liveRows.map((r) => [r.id, r.databaseId]));

  // 3. One query: label cells (text/title) for those rows. We pick, per target
  //    database, the lowest-position text property as the label property.
  const targetDbIds = [...new Set(liveRows.map((r) => r.databaseId))];
  const labelProps =
    targetDbIds.length === 0
      ? []
      : await db
          .select({
            id: schema.dbProperties.id,
            databaseId: schema.dbProperties.databaseId,
            type: schema.dbProperties.type,
            position: schema.dbProperties.position,
          })
          .from(schema.dbProperties)
          .where(inArray(schema.dbProperties.databaseId, targetDbIds));
  const labelPropByDb = new Map<string, string>();
  for (const p of labelProps.sort((a, b) => a.position - b.position)) {
    if (p.type === 'text' && !labelPropByDb.has(p.databaseId)) {
      labelPropByDb.set(p.databaseId, p.id);
    }
  }
  const labelPropIds = [...labelPropByDb.values()];
  const labelCells =
    labelPropIds.length === 0
      ? []
      : await db
          .select({
            rowId: schema.dbCells.rowId,
            propertyId: schema.dbCells.propertyId,
            value: schema.dbCells.value,
          })
          .from(schema.dbCells)
          .where(
            and(
              inArray(schema.dbCells.rowId, [...allIds]),
              inArray(schema.dbCells.propertyId, labelPropIds),
            ),
          );
  const labelByRow = new Map<string, string>();
  for (const c of labelCells) {
    if (typeof c.value === 'string' && c.value.trim() !== '') {
      labelByRow.set(c.rowId, c.value);
    }
  }

  // 4. Apply per cell: drop dangling ids, build labels.
  for (const cells of cellsByRow.values()) {
    for (const pid of relPropIds) {
      const v = cells[pid];
      if (!Array.isArray(v)) continue;
      const ids: string[] = [];
      const labels: string[] = [];
      for (const id of v as string[]) {
        if (!liveById.has(id)) continue; // dangling — drop
        ids.push(id);
        labels.push(labelByRow.get(id) ?? 'Untitled');
      }
      cells[pid] = { ids, labels } satisfies ResolvedRelation;
    }
  }
}
