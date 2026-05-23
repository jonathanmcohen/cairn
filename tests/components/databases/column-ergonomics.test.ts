import { describe, expect, it } from 'vitest';
import {
  type ColumnErgonomics,
  columnLayout,
  DEFAULT_COLUMN_WIDTH,
} from '@/components/databases/column-ergonomics';

const props = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' },
];

describe('columnLayout', () => {
  it('drops hidden columns, preserving order', () => {
    const cfg: ColumnErgonomics = {
      columnWidths: {},
      frozenColumnIds: [],
      hiddenColumnIds: ['p2'],
    };
    const layout = columnLayout(props, cfg);
    expect(layout.map((c) => c.id)).toEqual(['p1', 'p3']);
  });

  it('applies per-column width and the default for unset columns', () => {
    const cfg: ColumnErgonomics = {
      columnWidths: { p1: 300 },
      frozenColumnIds: [],
      hiddenColumnIds: [],
    };
    const layout = columnLayout(props, cfg);
    expect(layout.find((c) => c.id === 'p1')?.width).toBe(300);
    expect(layout.find((c) => c.id === 'p2')?.width).toBe(DEFAULT_COLUMN_WIDTH);
  });

  it('marks frozen columns and computes cumulative inset-inline-start offsets', () => {
    const cfg: ColumnErgonomics = {
      columnWidths: { p1: 100, p2: 150 },
      frozenColumnIds: ['p1', 'p2'],
      hiddenColumnIds: [],
    };
    const layout = columnLayout(props, cfg);
    const p1 = layout.find((c) => c.id === 'p1');
    const p2 = layout.find((c) => c.id === 'p2');
    const p3 = layout.find((c) => c.id === 'p3');
    expect(p1?.frozen).toBe(true);
    expect(p1?.insetInlineStart).toBe(0);
    expect(p2?.frozen).toBe(true);
    expect(p2?.insetInlineStart).toBe(100); // after p1's width
    expect(p3?.frozen).toBe(false);
    expect(p3?.insetInlineStart).toBeNull();
  });

  it('a frozen column that is also hidden is simply absent (no offset slot)', () => {
    const cfg: ColumnErgonomics = {
      columnWidths: { p1: 100 },
      frozenColumnIds: ['p1', 'p2'],
      hiddenColumnIds: ['p1'],
    };
    const layout = columnLayout(props, cfg);
    expect(layout.map((c) => c.id)).toEqual(['p2', 'p3']);
    // p2 is now the first frozen column → offset 0
    expect(layout.find((c) => c.id === 'p2')?.insetInlineStart).toBe(0);
  });
});
