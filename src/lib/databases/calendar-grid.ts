/** Pure helpers for the calendar month grid. No React, no I/O — all UTC-based. */

export type DayCell = {
  /** UTC midnight of the day this cell represents. */
  date: Date;
  /** `YYYY-MM-DD` key. */
  key: string;
  /** True when the day falls in the anchor month (vs. leading/trailing padding). */
  inMonth: boolean;
};

export type RowLike = { row: { id: string }; cells: Record<string, unknown> };

/** `YYYY-MM-DD` (UTC) for a Date or ISO string; null when unparseable/empty. */
export function dayKey(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Monday-aligned 6×7 (42-cell) grid spanning the anchor's month. */
export function monthGrid(anchor: Date): DayCell[] {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  // Days from the preceding Monday (getUTCDay: 0=Sun..6=Sat → Monday-based offset).
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month, 1 - offset));
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start.getTime() + i * 86_400_000);
    cells.push({
      date,
      key: date.toISOString().slice(0, 10),
      inMonth: date.getUTCMonth() === month,
    });
  }
  return cells;
}

/** Bucket rows by the `YYYY-MM-DD` key of their `datePropertyId` cell. */
export function bucketRowsByDay<T extends RowLike>(
  rows: readonly T[],
  datePropertyId: string,
): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    const key = dayKey(r.cells[datePropertyId]);
    if (key === null) continue;
    const existing = buckets.get(key);
    if (existing) existing.push(r);
    else buckets.set(key, [r]);
  }
  return buckets;
}
