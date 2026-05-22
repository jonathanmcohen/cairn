import { describe, expect, it } from 'vitest';
import { buildRowForest, flattenVisible, type TreeRow } from '@/components/databases/row-tree';

function r(id: string, parentRowId: string | null): TreeRow {
  return { id, parentRowId };
}

describe('buildRowForest', () => {
  it('roots top-level rows and nests children in input order', () => {
    const forest = buildRowForest([
      r('a', null),
      r('b', 'a'),
      r('c', 'a'),
      r('d', null),
      r('e', 'b'),
    ]);
    expect(forest.map((n) => n.row.id)).toEqual(['a', 'd']);
    const a = forest[0];
    expect(a?.children.map((n) => n.row.id)).toEqual(['b', 'c']);
    expect(a?.children[0]?.children.map((n) => n.row.id)).toEqual(['e']);
    expect(a?.depth).toBe(0);
    expect(a?.children[0]?.depth).toBe(1);
    expect(a?.children[0]?.children[0]?.depth).toBe(2);
  });

  it('treats a row whose parent is absent (filtered out) as a root', () => {
    const forest = buildRowForest([r('b', 'a')]); // parent 'a' not in the list
    expect(forest.map((n) => n.row.id)).toEqual(['b']);
  });

  it('does not loop on pre-existing cyclic data', () => {
    // Defensive: data should never contain a cycle (guarded on write), but the
    // renderer must not hang if it somehow does.
    const forest = buildRowForest([r('a', 'b'), r('b', 'a')]);
    // Neither is a root; nothing is double-visited — forest is empty.
    expect(forest).toEqual([]);
  });
});

describe('flattenVisible', () => {
  it('lists all rows depth-first when nothing is collapsed', () => {
    const forest = buildRowForest([r('a', null), r('b', 'a'), r('c', 'b'), r('d', null)]);
    const visible = flattenVisible(forest, new Set());
    expect(visible.map((n) => n.row.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('hides the subtree under a collapsed row', () => {
    const forest = buildRowForest([r('a', null), r('b', 'a'), r('c', 'b'), r('d', null)]);
    const visible = flattenVisible(forest, new Set(['a']));
    expect(visible.map((n) => n.row.id)).toEqual(['a', 'd']);
  });

  it('marks nodes with children via hasChildren', () => {
    const forest = buildRowForest([r('a', null), r('b', 'a'), r('d', null)]);
    const visible = flattenVisible(forest, new Set());
    const byId = new Map(visible.map((n) => [n.row.id, n]));
    expect(byId.get('a')?.hasChildren).toBe(true);
    expect(byId.get('b')?.hasChildren).toBe(false);
    expect(byId.get('d')?.hasChildren).toBe(false);
  });
});
