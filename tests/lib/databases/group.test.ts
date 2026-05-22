import { describe, expect, it } from 'vitest';
import { groupRows, type RowLike } from '@/lib/databases/group';

const opts = [
  { id: 'todo', name: 'To do' },
  { id: 'doing', name: 'Doing' },
  { id: 'done', name: 'Done' },
];

const rows: RowLike[] = [
  { row: { id: 'r1' }, cells: { g: 'todo' } },
  { row: { id: 'r2' }, cells: { g: 'done' } },
  { row: { id: 'r3' }, cells: { g: 'todo' } },
  { row: { id: 'r4' }, cells: { g: null } },
  { row: { id: 'r5' }, cells: {} },
  { row: { id: 'r6' }, cells: { g: '' } },
];

describe('groupRows', () => {
  it('returns Uncategorized first, then groups in option order', () => {
    const groups = groupRows(rows, 'g', opts);
    expect(groups.map((g) => g.id)).toEqual(['', 'todo', 'doing', 'done']);
  });

  it('buckets each row into its option (null/empty/absent → Uncategorized)', () => {
    const groups = groupRows(rows, 'g', opts);
    const byId = new Map(groups.map((g) => [g.id, g.rows.map((r) => r.row.id)]));
    expect(byId.get('')).toEqual(['r4', 'r5', 'r6']);
    expect(byId.get('todo')).toEqual(['r1', 'r3']);
    expect(byId.get('doing')).toEqual([]);
    expect(byId.get('done')).toEqual(['r2']);
  });

  it('uses the option name as the group label', () => {
    const groups = groupRows(rows, 'g', opts);
    const todo = groups.find((g) => g.id === 'todo');
    expect(todo?.name).toBe('To do');
    expect(groups.find((g) => g.id === '')?.name).toBe('Uncategorized');
  });
});
