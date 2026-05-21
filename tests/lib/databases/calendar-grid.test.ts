import { describe, expect, it } from 'vitest';
import { bucketRowsByDay, dayKey, monthGrid } from '@/lib/databases/calendar-grid';

describe('dayKey', () => {
  it('formats a Date as YYYY-MM-DD (UTC)', () => {
    expect(dayKey(new Date('2026-05-21T13:00:00.000Z'))).toBe('2026-05-21');
  });
  it('parses an ISO string', () => {
    expect(dayKey('2026-01-09T00:00:00.000Z')).toBe('2026-01-09');
  });
  it('returns null for an unparseable value', () => {
    expect(dayKey('not a date')).toBeNull();
    expect(dayKey(null)).toBeNull();
    expect(dayKey(undefined)).toBeNull();
  });
});

describe('monthGrid', () => {
  it('returns 42 cells (6 weeks) Monday-aligned', () => {
    // May 2026: 1st is a Friday; grid starts the Monday on/before May 1.
    const cells = monthGrid(new Date('2026-05-21T00:00:00.000Z'));
    expect(cells).toHaveLength(42);
    expect(cells[0]?.date.getUTCDay()).toBe(1); // Monday
  });

  it('flags which cells fall inside the anchor month', () => {
    const cells = monthGrid(new Date('2026-05-21T00:00:00.000Z'));
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31); // May has 31 days
    expect(inMonth[0]?.key).toBe('2026-05-01');
    expect(inMonth.at(-1)?.key).toBe('2026-05-31');
  });
});

describe('bucketRowsByDay', () => {
  const rows = [
    { row: { id: 'r1' }, cells: { d: '2026-05-21T09:00:00.000Z' } },
    { row: { id: 'r2' }, cells: { d: '2026-05-21T18:00:00.000Z' } },
    { row: { id: 'r3' }, cells: { d: '2026-05-02T00:00:00.000Z' } },
    { row: { id: 'r4' }, cells: { d: null } }, // dropped
    { row: { id: 'r5' }, cells: {} }, // dropped
  ];

  it('groups rows by their date cell day key', () => {
    const buckets = bucketRowsByDay(rows, 'd');
    expect(buckets.get('2026-05-21')?.map((r) => r.row.id)).toEqual(['r1', 'r2']);
    expect(buckets.get('2026-05-02')?.map((r) => r.row.id)).toEqual(['r3']);
  });

  it('drops rows whose date cell is empty or unparseable', () => {
    const buckets = bucketRowsByDay(rows, 'd');
    const total = [...buckets.values()].reduce((n, b) => n + b.length, 0);
    expect(total).toBe(3);
  });
});
