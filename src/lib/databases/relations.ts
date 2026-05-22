import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '@/db/schema';

/**
 * A relation property points at exactly one target database (same workspace, validated separately).
 * `reversePropertyId`, when present, links this relation to its mirror on the target database
 * (spec decision #1). Both halves of a pair carry it, pointing at each other.
 */
export const RelationConfig = z.object({
  targetDatabaseId: z.uuid(),
  reversePropertyId: z.uuid().optional(),
});

export type RelationConfig = z.infer<typeof RelationConfig>;

/** A relation cell value is a list of related db_rows ids. */
export const RelationCellValue = z.array(z.uuid());

/** Read a property's targetDatabaseId, or undefined if the config is malformed. */
export function relationTargetId(config: unknown): string | undefined {
  const parsed = RelationConfig.safeParse(config);
  return parsed.success ? parsed.data.targetDatabaseId : undefined;
}

/** Read a relation property's reversePropertyId, or undefined if unset/malformed. */
export function relationReverseId(config: unknown): string | undefined {
  const parsed = RelationConfig.safeParse(config);
  return parsed.success ? parsed.data.reversePropertyId : undefined;
}

/**
 * Create the mirrored relation for `sourcePropertyId` on its target database and link
 * both configs by `reversePropertyId`. Runs inside the caller's transaction.
 * Throws if the source is not a relation or already has a reverse.
 * Returns the newly-created reverse property.
 */
export async function createReverseRelationProperty(
  tx: PostgresJsDatabase<typeof schema>,
  input: { sourcePropertyId: string; reverseName: string },
): Promise<schema.DbProperty> {
  const [source] = await tx
    .select()
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.id, input.sourcePropertyId))
    .limit(1);
  if (!source) throw new Error('source property not found');
  if (source.type !== 'relation') throw new Error('source property is not a relation');

  const sourceCfg = RelationConfig.safeParse(source.config);
  if (!sourceCfg.success) throw new Error('source relation has no valid config');
  if (sourceCfg.data.reversePropertyId) throw new Error('source already has a reverse property');

  const targetDatabaseId = sourceCfg.data.targetDatabaseId;

  // Position the mirror at the end of the target database's property list.
  const existing = await tx
    .select({ position: schema.dbProperties.position })
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.databaseId, targetDatabaseId));
  const nextPosition = existing.reduce((m, p) => Math.max(m, p.position + 1), 0);

  const [reverse] = await tx
    .insert(schema.dbProperties)
    .values({
      databaseId: targetDatabaseId,
      name: input.reverseName,
      type: 'relation',
      position: nextPosition,
      // reverse points back at the source's database, and links to the source property
      config: { targetDatabaseId: source.databaseId, reversePropertyId: source.id },
    })
    .returning();
  if (!reverse) throw new Error('reverse property insert failed');

  // Link the source to the new reverse.
  await tx
    .update(schema.dbProperties)
    .set({ config: { targetDatabaseId, reversePropertyId: reverse.id } })
    .where(eq(schema.dbProperties.id, source.id));

  return reverse;
}

/**
 * Drop the `reversePropertyId` link on `propertyId`, degrading it to a plain relation.
 * Called on the surviving partner when the other side of a pair is deleted (spec decision #1:
 * deleting one side clears the other's link; it is NOT auto-deleted). No-op if it has no reverse.
 */
export async function clearReverseLink(
  tx: PostgresJsDatabase<typeof schema>,
  propertyId: string,
): Promise<void> {
  const [prop] = await tx
    .select()
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.id, propertyId))
    .limit(1);
  if (!prop) return;
  const cfg = RelationConfig.safeParse(prop.config);
  if (!cfg.success || !cfg.data.reversePropertyId) return;
  await tx
    .update(schema.dbProperties)
    .set({ config: { targetDatabaseId: cfg.data.targetDatabaseId } })
    .where(eq(schema.dbProperties.id, propertyId));
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

/**
 * Mirror relation cell changes onto the paired (reverse) relation, inside the caller's
 * transaction (spec decision #1). For each paired relation property in `props`, diff the
 * before/after id lists for `rowId` and apply the deltas to the reverse property's cells on
 * each affected target row: an ADD of target T means T.reverse += rowId; a REMOVE means
 * T.reverse -= rowId.
 *
 * Re-entrancy: each `rowId:propertyId` pair touched is recorded in `guard`; a cell already in
 * the guard is skipped, so the mirror's own write cannot re-trigger sync within this
 * transaction. The caller passes a shared `guard` Set (defaulting to a fresh one) and should
 * seed it with the originating `rowId:propertyId` before the first call when chaining.
 *
 * Plain (unpaired) relations are ignored.
 */
export async function syncRelationCells(
  tx: PostgresJsDatabase<typeof schema>,
  input: {
    rowId: string;
    props: Pick<schema.DbProperty, 'id' | 'type' | 'config'>[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    guard?: Set<string>;
  },
): Promise<void> {
  const guard = input.guard ?? new Set<string>();
  // The originating cell is the source of truth this pass; never let a nested write touch it.
  for (const p of input.props) {
    if (p.type === 'relation') guard.add(`${input.rowId}:${p.id}`);
  }

  for (const p of input.props) {
    if (p.type !== 'relation') continue;
    const reverseId = relationReverseId(p.config);
    if (!reverseId) continue; // plain relation — nothing to mirror

    const before = toIdArray(input.before[p.id]);
    const after = toIdArray(input.after[p.id]);
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const added = after.filter((id) => !beforeSet.has(id));
    const removed = before.filter((id) => !afterSet.has(id));
    if (added.length === 0 && removed.length === 0) continue;

    for (const targetRowId of added) {
      await mirrorEdit(tx, targetRowId, reverseId, input.rowId, 'add', guard);
    }
    for (const targetRowId of removed) {
      await mirrorEdit(tx, targetRowId, reverseId, input.rowId, 'remove', guard);
    }
  }
}

function toIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** Apply one add/remove of `linkedRowId` to (targetRowId, reversePropertyId), guard-checked. */
async function mirrorEdit(
  tx: PostgresJsDatabase<typeof schema>,
  targetRowId: string,
  reversePropertyId: string,
  linkedRowId: string,
  op: 'add' | 'remove',
  guard: Set<string>,
): Promise<void> {
  const key = `${targetRowId}:${reversePropertyId}`;
  if (guard.has(key)) return; // already authoritative this transaction — do not re-touch
  guard.add(key);

  const [cell] = await tx
    .select({ value: schema.dbCells.value })
    .from(schema.dbCells)
    .where(
      and(eq(schema.dbCells.rowId, targetRowId), eq(schema.dbCells.propertyId, reversePropertyId)),
    )
    .limit(1);
  const current = toIdArray(cell?.value);
  const set = new Set(current);
  if (op === 'add') set.add(linkedRowId);
  else set.delete(linkedRowId);
  const next = [...set];

  await tx
    .insert(schema.dbCells)
    .values({ rowId: targetRowId, propertyId: reversePropertyId, value: next })
    .onConflictDoUpdate({
      target: [schema.dbCells.rowId, schema.dbCells.propertyId],
      set: { value: next },
    });
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
