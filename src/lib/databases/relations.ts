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
