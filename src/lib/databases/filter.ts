import { sql as rawSql, type SQL } from 'drizzle-orm';
import type * as schema from '@/db/schema';

export type FilterCondition = { propertyId: string; op: string; value: unknown };

/**
 * Compile a list of conditions to a SQL fragment that filters db_rows.
 * Each condition becomes: EXISTS (SELECT 1 FROM db_cells WHERE row_id = db_rows.id AND property_id = '...' AND <predicate>)
 * Conditions are AND-ed.
 */
export function compileFilters(
  conditions: FilterCondition[],
  propsById: Map<string, schema.DbProperty>,
): SQL | undefined {
  if (conditions.length === 0) return undefined;
  const fragments: SQL[] = [];
  for (const c of conditions) {
    const prop = propsById.get(c.propertyId);
    if (!prop) continue;
    const inner = predicateFor(prop.type, c.op, c.value);
    if (!inner) continue;
    fragments.push(rawSql`EXISTS (
      SELECT 1 FROM db_cells dc
      WHERE dc.row_id = db_rows.id
        AND dc.property_id = ${c.propertyId}::uuid
        AND ${inner}
    )`);
  }
  if (fragments.length === 0) return undefined;
  return fragments.reduce((acc, cur) => rawSql`${acc} AND ${cur}`);
}

function predicateFor(type: schema.PropertyType, op: string, value: unknown): SQL | null {
  switch (type) {
    case 'text':
    case 'url':
    case 'select':
      switch (op) {
        case 'eq':
          return rawSql`dc.value::text = ${JSON.stringify(value)}::jsonb::text`;
        case 'neq':
          return rawSql`dc.value::text <> ${JSON.stringify(value)}::jsonb::text`;
        case 'contains':
          return rawSql`dc.value::text ILIKE ${`"%${String(value)}%"`}`;
        case 'not_contains':
          return rawSql`dc.value::text NOT ILIKE ${`"%${String(value)}%"`}`;
        case 'starts_with':
          return rawSql`dc.value::text ILIKE ${`"${String(value)}%"`}`;
        case 'ends_with':
          return rawSql`dc.value::text ILIKE ${`"%${String(value)}"`}`;
        case 'is_empty':
          return rawSql`(dc.value IS NULL OR dc.value::text = '""')`;
        case 'is_not_empty':
          return rawSql`dc.value IS NOT NULL AND dc.value::text <> '""'`;
        default:
          return null;
      }
    case 'number':
      switch (op) {
        case 'eq':
          return rawSql`(dc.value)::numeric = ${Number(value)}`;
        case 'neq':
          return rawSql`(dc.value)::numeric <> ${Number(value)}`;
        case 'gt':
          return rawSql`(dc.value)::numeric > ${Number(value)}`;
        case 'gte':
          return rawSql`(dc.value)::numeric >= ${Number(value)}`;
        case 'lt':
          return rawSql`(dc.value)::numeric < ${Number(value)}`;
        case 'lte':
          return rawSql`(dc.value)::numeric <= ${Number(value)}`;
        case 'is_empty':
          return rawSql`dc.value IS NULL`;
        default:
          return null;
      }
    case 'checkbox':
      switch (op) {
        case 'is_true':
          return rawSql`dc.value::text = 'true'`;
        case 'is_false':
          return rawSql`(dc.value IS NULL OR dc.value::text = 'false')`;
        default:
          return null;
      }
    case 'date':
      switch (op) {
        case 'eq':
          return rawSql`(dc.value #>> '{}')::date = ${String(value)}::date`;
        case 'gt':
          return rawSql`(dc.value #>> '{}')::date > ${String(value)}::date`;
        case 'gte':
          return rawSql`(dc.value #>> '{}')::date >= ${String(value)}::date`;
        case 'lt':
          return rawSql`(dc.value #>> '{}')::date < ${String(value)}::date`;
        case 'lte':
          return rawSql`(dc.value #>> '{}')::date <= ${String(value)}::date`;
        case 'is_empty':
          return rawSql`dc.value IS NULL`;
        default:
          return null;
      }
    case 'multi_select':
      switch (op) {
        case 'contains':
          return rawSql`dc.value @> ${JSON.stringify([String(value)])}::jsonb`;
        case 'not_contains':
          return rawSql`NOT (dc.value @> ${JSON.stringify([String(value)])}::jsonb)`;
        case 'is_empty':
          return rawSql`(dc.value IS NULL OR jsonb_array_length(dc.value) = 0)`;
        default:
          return null;
      }
  }
  return null;
}
