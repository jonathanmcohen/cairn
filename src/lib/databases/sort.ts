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
    const dir = rawSql.raw(s.direction.toUpperCase());
    // v0.9.9 F2 #243 — computed (read-only) types order on the db_rows column
    // directly; person/file are unsortable (skipped). All others read db_cells.
    const rowCol = computedRowColumn(prop.type);
    if (rowCol) {
      parts.push(rawSql`${rowCol} ${dir} NULLS LAST`);
      continue;
    }
    if (prop.type === 'person' || prop.type === 'file') continue;
    const expr = rawSql.raw(cellExpr(prop.type));
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

/**
 * v0.9.9 F2 #243 — the db_rows column to ORDER BY for a computed property type,
 * or null for non-computed types.
 */
function computedRowColumn(type: schema.PropertyType): SQL | null {
  switch (type) {
    case 'created_time':
      return rawSql`db_rows.created_at`;
    case 'last_edited_time':
      return rawSql`db_rows.updated_at`;
    case 'created_by':
      return rawSql`db_rows.created_by`;
    case 'last_edited_by':
      return rawSql`db_rows.updated_by`;
    default:
      return null;
  }
}
