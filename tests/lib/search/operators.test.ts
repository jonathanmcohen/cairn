import { describe, expect, it } from 'vitest';
import { filtersFromOperators, parseQuery } from '@/lib/search/operators';

describe('parseQuery', () => {
  it('returns empty result for empty input', () => {
    expect(parseQuery('')).toEqual({ free: '', ops: [], warnings: [] });
    expect(parseQuery('   ')).toEqual({ free: '', ops: [], warnings: [] });
  });

  it('extracts a single operator', () => {
    const r = parseQuery('from:alice');
    expect(r.ops).toEqual([{ key: 'from', value: 'alice' }]);
    expect(r.free).toBe('');
    expect(r.warnings).toEqual([]);
  });

  it('interleaves free text + operators', () => {
    const r = parseQuery('release notes from:alice tag:bug');
    expect(r.free).toBe('release notes');
    expect(r.ops).toEqual([
      { key: 'from', value: 'alice' },
      { key: 'tag', value: 'bug' },
    ]);
  });

  it('respects quoted values (single or double)', () => {
    expect(parseQuery('tag:"release notes"').ops).toEqual([
      { key: 'tag', value: 'release notes' },
    ]);
    expect(parseQuery("tag:'multi word'").ops).toEqual([{ key: 'tag', value: 'multi word' }]);
  });

  it('honors backslash-escape of the value separator', () => {
    const r = parseQuery('tag:foo\\:bar');
    expect(r.ops).toEqual([{ key: 'tag', value: 'foo:bar' }]);
  });

  it('records unknown keys as warnings (does not throw)', () => {
    const r = parseQuery('weird:value real text');
    expect(r.ops).toEqual([]);
    expect(r.warnings).toEqual([{ kind: 'unknown_key', token: 'weird:value' }]);
    expect(r.free).toBe('real text');
  });

  it('handles malformed (trailing colon, empty value) as free text', () => {
    expect(parseQuery('from:').free).toBe('from:');
    expect(parseQuery('from:').ops).toEqual([]);
  });

  it('accepts ISO dates for before/after', () => {
    const r = parseQuery('after:2025-01-01 before:2025-12-31');
    expect(r.ops).toEqual([
      { key: 'after', value: '2025-01-01' },
      { key: 'before', value: '2025-12-31' },
    ]);
  });

  it('supports type and status', () => {
    expect(parseQuery('type:page status:draft').ops).toEqual([
      { key: 'type', value: 'page' },
      { key: 'status', value: 'draft' },
    ]);
  });
});

describe('filtersFromOperators', () => {
  it('projects from-as-uuid into filters.author', () => {
    const uuid = '11111111-1111-1111-1111-111111111111';
    const filters = filtersFromOperators([{ key: 'from', value: uuid }]);
    expect(filters.author).toBe(uuid);
  });

  it('skips from-as-username (caller resolves later)', () => {
    const filters = filtersFromOperators([{ key: 'from', value: 'alice' }]);
    expect(filters.author).toBeUndefined();
  });

  it('projects before/after into dateRange', () => {
    const filters = filtersFromOperators([
      { key: 'after', value: '2025-01-01' },
      { key: 'before', value: '2025-12-31' },
    ]);
    expect(filters.dateRange).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('projects type into filters.types', () => {
    const filters = filtersFromOperators([
      { key: 'type', value: 'page' },
      { key: 'type', value: 'db_row' },
    ]);
    expect(filters.types).toEqual(['page', 'db_row']);
  });

  it('drops invalid type values', () => {
    const filters = filtersFromOperators([{ key: 'type', value: 'banana' }]);
    expect(filters.types).toBeUndefined();
  });

  it('tag + status pass through unprojected (consumers handle them)', () => {
    const filters = filtersFromOperators([
      { key: 'tag', value: 'bug' },
      { key: 'status', value: 'draft' },
    ]);
    expect(filters.author).toBeUndefined();
    expect(filters.dateRange).toBeUndefined();
  });
});
