import { sql as rawSql, type SQL } from 'drizzle-orm';
import type * as schema from '@/db/schema';

export type SortSpec = { propertyId: string; direction: 'asc' | 'desc' };

/**
 * Compile sort specs into an ORDER BY SQL fragment. Each sort key becomes a
 * correlated subquery against db_cells. Unknown property ids are skipped.
 */
export function compileSorts(
  sorts: SortSpec[],
  propsById: Map<string, schema.DbProperty>,
): SQL | undefined {
  if (sorts.length === 0) return undefined;
  const parts: SQL[] = [];
  for (const s of sorts) {
    const prop = propsById.get(s.propertyId);
    if (!prop) continue;
    const expr = rawSql.raw(cellExpr(prop.type));
    const dir = rawSql.raw(s.direction.toUpperCase());
    parts.push(rawSql`(
      SELECT ${expr} FROM db_cells dc
      WHERE dc.row_id = db_rows.id AND dc.property_id = ${s.propertyId}::uuid
      LIMIT 1
    ) ${dir} NULLS LAST`);
  }
  if (parts.length === 0) return undefined;
  return parts.reduce((acc, cur) => rawSql`${acc}, ${cur}`);
}

function cellExpr(type: schema.PropertyType): string {
  switch (type) {
    case 'number':
      return '(dc.value)::numeric';
    case 'date':
      return "(dc.value #>> '{}')::timestamptz";
    case 'checkbox':
      return '(dc.value)::boolean';
    default:
      return 'dc.value::text';
  }
}
