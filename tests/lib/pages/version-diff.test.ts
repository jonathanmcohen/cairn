import { describe, expect, it } from 'vitest';
import { diffSnapshots, type PMDoc, type PMNode } from '@/lib/pages/version-diff';

const para = (text: string): PMNode => ({
  type: 'paragraph',
  attrs: {},
  content: [{ type: 'text', text }],
});

const heading = (level: number, text: string): PMNode => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});

const docOf = (...blocks: PMNode[]): PMDoc => ({ type: 'doc', content: blocks });

describe('diffSnapshots', () => {
  it('returns all unchanged for identical docs', () => {
    const d = docOf(heading(1, 'Title'), para('Hello'));
    const out = diffSnapshots(d, d);
    expect(out.every((b) => b.kind === 'unchanged')).toBe(true);
    expect(out).toHaveLength(2);
  });

  it('detects a pure addition', () => {
    const a = docOf(para('one'));
    const b = docOf(para('one'), para('two'));
    const out = diffSnapshots(a, b);
    expect(out.map((b) => b.kind)).toEqual(['unchanged', 'added']);
  });

  it('detects a pure deletion', () => {
    const a = docOf(para('one'), para('two'));
    const b = docOf(para('one'));
    const out = diffSnapshots(a, b);
    expect(out.map((b) => b.kind)).toEqual(['unchanged', 'removed']);
  });

  it('detects a same-type-same-position content change as changed + inline diff', () => {
    const a = docOf(para('the quick brown fox'));
    const b = docOf(para('the slow brown fox'));
    const out = diffSnapshots(a, b);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('changed');
    if (out[0]?.kind === 'changed') {
      const adds = out[0].inlineDiff.filter((d) => d.kind === 'add').map((d) => d.text);
      const removes = out[0].inlineDiff.filter((d) => d.kind === 'remove').map((d) => d.text);
      expect(adds).toContain('slow');
      expect(removes).toContain('quick');
    }
  });

  it('treats heading-with-different-level as removed+added (attrs differ)', () => {
    const a = docOf(heading(1, 'Title'));
    const b = docOf(heading(2, 'Title'));
    const out = diffSnapshots(a, b);
    expect(out.map((b) => b.kind).sort()).toEqual(['added', 'removed']);
  });

  it('handles a move: A=[x,y,z] B=[z,x,y] → signature LCS aligns positions, content diffs flag each (no move detection in v1)', () => {
    const a = docOf(para('x'), para('y'), para('z'));
    const b = docOf(para('z'), para('x'), para('y'));
    const out = diffSnapshots(a, b);
    // All three blocks share signature (paragraph + empty attrs), so LCS matches
    // them position-by-position. Each pair has different text → emits `changed`.
    expect(out).toHaveLength(3);
    expect(out.every((b) => b.kind === 'changed')).toBe(true);
  });

  it('handles replace: A=[para] B=[heading]', () => {
    const a = docOf(para('hello'));
    const b = docOf(heading(1, 'hello'));
    const out = diffSnapshots(a, b);
    expect(out.map((b) => b.kind).sort()).toEqual(['added', 'removed']);
  });

  it('survives empty docs', () => {
    expect(diffSnapshots(docOf(), docOf())).toEqual([]);
    expect(diffSnapshots(docOf(para('only-a')), docOf()).map((b) => b.kind)).toEqual(['removed']);
    expect(diffSnapshots(docOf(), docOf(para('only-b'))).map((b) => b.kind)).toEqual(['added']);
  });
});
