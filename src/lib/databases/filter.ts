import { sql as rawSql, type SQL } from 'drizzle-orm';
import type * as schema from '@/db/schema';

export type FilterCondition = { propertyId: string; op: string; value: unknown };

/**
 * "Absence-inclusive" ops must match rows that have NO cell for the property at
 * all (e.g. `is_empty`, or checkbox `is false` where a missing cell counts as
 * false). For these, `predicateFor` returns the *presence* predicate (the
 * condition for a row that should be EXCLUDED), which `compileFilters` wraps in
 * `NOT EXISTS`. All other ops keep the plain `EXISTS` behavior.
 */
function isAbsenceInclusive(type: schema.PropertyType, op: string, value: unknown): boolean {
  if (op === 'is_empty') return true;
  if (type === 'checkbox' && op === 'is' && value === false) return true;
  return false;
}

/**
 * Compile a list of conditions to a SQL fragment that filters db_rows.
 * Each condition becomes: EXISTS (SELECT 1 FROM db_cells WHERE row_id = db_rows.id AND property_id = '...' AND <predicate>)
 * Absence-inclusive ops use NOT EXISTS (... AND <presence-predicate>) instead, so
 * rows with no cell for the property are matched. Conditions are AND-ed.
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
    // v0.9.9 F2 #243 — computed (read-only) types live in db_rows columns, not
    // db_cells, so they filter on the row directly (no EXISTS subquery).
    const rowExpr = computedRowExpr(prop.type);
    if (rowExpr) {
      const pred = rowColumnPredicate(rowExpr, c.op, c.value);
      if (pred) fragments.push(pred);
      continue;
    }
    const inner = predicateFor(prop.type, c.op, c.value);
    if (!inner) continue;
    const keyword = isAbsenceInclusive(prop.type, c.op, c.value)
      ? rawSql`NOT EXISTS`
      : rawSql`EXISTS`;
    fragments.push(rawSql`${keyword} (
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
    // v0.9.9 F2 #243 — email/phone are plain text cells; reuse the text ops.
    case 'email':
    case 'phone':
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
        case 'is':
          return rawSql`dc.value::text = ${JSON.stringify(value)}::jsonb::text`;
        case 'is_not':
          return rawSql`dc.value::text <> ${JSON.stringify(value)}::jsonb::text`;
        case 'is_any_of': {
          const arr = Array.isArray(value) ? value.map((v) => String(v)) : [String(value)];
          if (arr.length === 0) return rawSql`false`;
          // Membership test via a single jsonb array param (keeps it parameterized
          // — drizzle's `sql` does not bind a JS array as a PG array literal).
          return rawSql`${JSON.stringify(arr)}::jsonb @> jsonb_build_array(dc.value #>> '{}')`;
        }
        case 'is_empty':
          // Presence predicate (wrapped in NOT EXISTS by compileFilters): a row
          // matches `is_empty` iff it has NO cell with a non-empty value.
          return rawSql`(dc.value IS NOT NULL AND dc.value::text <> '""')`;
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
        case 'between': {
          const [lo, hi] = Array.isArray(value) ? value : [value, value];
          return rawSql`(dc.value)::numeric BETWEEN ${Number(lo)} AND ${Number(hi)}`;
        }
        case 'is_empty':
          // Presence predicate (wrapped in NOT EXISTS): matches when no cell has a value.
          return rawSql`dc.value IS NOT NULL`;
        default:
          return null;
      }
    case 'checkbox':
      switch (op) {
        case 'is_true':
          return rawSql`dc.value::text = 'true'`;
        case 'is_false':
          return rawSql`(dc.value IS NULL OR dc.value::text = 'false')`;
        case 'is':
          // Presence predicate = "cell is true". `is true` -> EXISTS (a true cell);
          // `is false` -> NOT EXISTS (a true cell), so missing/false cells match.
          return rawSql`dc.value::text = 'true'`;
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
        case 'neq':
          return rawSql`(dc.value #>> '{}')::date <> ${String(value)}::date`;
        case 'between': {
          const [lo, hi] = Array.isArray(value) ? value : [value, value];
          return rawSql`(dc.value #>> '{}')::date BETWEEN ${String(lo)}::date AND ${String(hi)}::date`;
        }
        case 'is_empty':
          // Presence predicate (wrapped in NOT EXISTS): matches when no cell has a value.
          return rawSql`dc.value IS NOT NULL`;
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
          // Presence predicate (wrapped in NOT EXISTS): matches when no cell holds a non-empty array.
          return rawSql`(dc.value IS NOT NULL AND jsonb_array_length(dc.value) > 0)`;
        default:
          return null;
      }
    default:
      return null;
  }
}

/**
 * v0.9.9 F2 #243 — the db_rows column backing a computed property type, or null
 * for non-computed types. created/last_edited time map to timestamp columns;
 * created/last_edited by map to the uuid editor columns.
 */
function computedRowExpr(type: schema.PropertyType): SQL | null {
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

/** Predicate against a db_rows column for the computed time/by types. */
function rowColumnPredicate(col: SQL, op: string, value: unknown): SQL | null {
  switch (op) {
    case 'eq':
      return rawSql`${col}::date = ${String(value)}::date`;
    case 'neq':
      return rawSql`${col}::date <> ${String(value)}::date`;
    case 'gt':
      return rawSql`${col} > ${String(value)}::date`;
    case 'gte':
      return rawSql`${col} >= ${String(value)}::date`;
    case 'lt':
      return rawSql`${col} < ${String(value)}::date`;
    case 'lte':
      return rawSql`${col} <= ${String(value)}::date`;
    case 'is_empty':
      return rawSql`${col} IS NULL`;
    case 'is_not_empty':
      return rawSql`${col} IS NOT NULL`;
    default:
      return null;
  }
}
