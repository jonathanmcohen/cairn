/**
 * Pure calc-footer aggregation for table/list views. Computed at query time over
 * the already-fetched rows — no SQL, no schema. The per-column function lives in
 * the db_views config jsonb (`calcFooter: { [propertyId]: CalcFn }`).
 */

export type CalcFn = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'empty' | 'filled';

export type CalcResult = { fn: CalcFn; value: number | null };

/** A cell value is "blank" when null/undefined or an empty string. */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** Coerce to a finite number, or null. Accepts numbers and numeric strings. */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Aggregate one column's raw cell values with the given function. */
export function aggregateColumn(
  values: readonly unknown[],
  fn: CalcFn,
  _propertyType: string,
): CalcResult {
  switch (fn) {
    case 'count':
      return { fn, value: values.length };
    case 'empty':
      return { fn, value: values.filter(isBlank).length };
    case 'filled':
      return { fn, value: values.filter((v) => !isBlank(v)).length };
    default: {
      const nums = values.map(toNumber).filter((n): n is number => n !== null);
      if (nums.length === 0) return { fn, value: null };
      if (fn === 'sum') return { fn, value: nums.reduce((a, b) => a + b, 0) };
      if (fn === 'avg') return { fn, value: nums.reduce((a, b) => a + b, 0) / nums.length };
      if (fn === 'min') return { fn, value: Math.min(...nums) };
      return { fn, value: Math.max(...nums) }; // max
    }
  }
}

type PropertyLike = { id: string; type: string };
type RowLike = { row: { id: string }; cells: Record<string, unknown> };

/**
 * Compute the footer for every column that has a configured function.
 * Returns `{ [propertyId]: CalcResult }`, skipping unknown ids + unconfigured columns.
 */
export function computeCalcFooter(
  rows: readonly RowLike[],
  properties: readonly PropertyLike[],
  calcConfig: Record<string, CalcFn> | undefined,
): Record<string, CalcResult> {
  const out: Record<string, CalcResult> = {};
  if (!calcConfig) return out;
  const byId = new Map(properties.map((p) => [p.id, p]));
  for (const [propertyId, fn] of Object.entries(calcConfig)) {
    const prop = byId.get(propertyId);
    if (!prop) continue;
    const values = rows.map((r) => r.cells[propertyId]);
    out[propertyId] = aggregateColumn(values, fn, prop.type);
  }
  return out;
}
