/** Pure helper: bucket already-fetched rows by a select property's options. No React, no I/O. */

export type RowLike = { row: { id: string }; cells: Record<string, unknown> };
export type SelectOption = { id: string; name: string };
export type RowGroup<T extends RowLike> = { id: string; name: string; rows: T[] };

/**
 * Group `rows` by their `groupByPropertyId` cell value, matched against `options`.
 * Returns a leading "Uncategorized" group (id `''`) for null/empty/absent cells,
 * then one group per option in option order (empty groups included).
 */
export function groupRows<T extends RowLike>(
  rows: readonly T[],
  groupByPropertyId: string,
  options: readonly SelectOption[],
): RowGroup<T>[] {
  const groups: RowGroup<T>[] = [
    { id: '', name: 'Uncategorized', rows: [] },
    ...options.map((o) => ({ id: o.id, name: o.name, rows: [] as T[] })),
  ];
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const r of rows) {
    const v = r.cells[groupByPropertyId];
    const key = typeof v === 'string' && v.length > 0 ? v : '';
    const target = byId.get(key) ?? byId.get('');
    target?.rows.push(r);
  }
  return groups;
}
