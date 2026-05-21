import { and, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { aggregate } from './aggregate';
import { rollupConfig } from './config';

/** A resolved relation cell (from Plan 2's relation resolution pass). */
type ResolvedRelation = { ids: string[]; labels: string[] };

function relationIds(cell: unknown): string[] {
  if (cell && typeof cell === 'object' && 'ids' in cell) {
    const ids = (cell as ResolvedRelation).ids;
    return Array.isArray(ids) ? ids : [];
  }
  // Defensive: an unresolved raw string[] (shouldn't happen after relation pass).
  return Array.isArray(cell) ? (cell as string[]) : [];
}

/**
 * Compute every rollup cell across many rows in ONE batched pass.
 * Must run AFTER the relation-resolution pass (relation cells are { ids, labels }).
 * - Reads each rollup's relation cell -> related row ids.
 * - One query for all referenced (rowId, targetPropertyId) cells.
 * - Aggregates per (row, rollup) via the pure `aggregate` module.
 */
export async function resolveRollupCells(
  db: PostgresJsDatabase<typeof schema>,
  rollupProps: Pick<schema.DbProperty, 'id' | 'config'>[],
  cellsByRow: Map<string, Record<string, unknown>>,
): Promise<void> {
  if (rollupProps.length === 0) return;

  // Parse configs once; skip malformed ones (defensive).
  const configs = new Map<string, ReturnType<typeof rollupConfig>>();
  const allRelatedIds = new Set<string>();
  const allTargetPropIds = new Set<string>();
  for (const rp of rollupProps) {
    const cfg = rollupConfig(rp.config);
    configs.set(rp.id, cfg);
    if (!cfg) continue;
    allTargetPropIds.add(cfg.targetPropertyId);
    for (const cells of cellsByRow.values()) {
      for (const id of relationIds(cells[cfg.relationPropertyId])) allRelatedIds.add(id);
    }
  }

  // Batched fetch of every needed target cell. Index by `${rowId}:${propertyId}`.
  const cellByKey = new Map<string, unknown>();
  if (allRelatedIds.size > 0 && allTargetPropIds.size > 0) {
    const fetched = await db
      .select({
        rowId: schema.dbCells.rowId,
        propertyId: schema.dbCells.propertyId,
        value: schema.dbCells.value,
      })
      .from(schema.dbCells)
      .where(
        and(
          inArray(schema.dbCells.rowId, [...allRelatedIds]),
          inArray(schema.dbCells.propertyId, [...allTargetPropIds]),
        ),
      );
    for (const c of fetched) cellByKey.set(`${c.rowId}:${c.propertyId}`, c.value);
  }

  // Aggregate per (row, rollup).
  for (const cells of cellsByRow.values()) {
    for (const rp of rollupProps) {
      const cfg = configs.get(rp.id);
      if (!cfg) {
        cells[rp.id] = { __error: 'invalid rollup config' };
        continue;
      }
      const ids = relationIds(cells[cfg.relationPropertyId]);
      // For `count` the related-row count is what matters; for the others we read
      // each related row's target cell (missing cell -> undefined, ignored by aggregate).
      const values =
        cfg.fn === 'count' ? ids : ids.map((id) => cellByKey.get(`${id}:${cfg.targetPropertyId}`));
      cells[rp.id] = aggregate(cfg.fn, values);
    }
  }
}
