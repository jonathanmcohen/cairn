import { describe, expect, it } from 'vitest';
import {
  acceptSuggestion,
  type Json,
  previewAccepted,
  rejectSuggestion,
} from '@/lib/suggestions/transform';

// A loosely-typed view used purely to index the returned doc in assertions.
// `content` is a numeric-indexed interface (NOT an array) so `content[0]` is
// `DocNode` rather than `DocNode | undefined` under noUncheckedIndexedAccess,
// while still exposing the `length`/`map`/`some` used by the assertions.
type Inline = { text?: string; marks?: unknown[] };
// A non-empty tuple: `content[0]` is `DocNode` (the first element is required),
// the rest spread keeps `.length`/`.map`/`.some` available. This sidesteps
// noUncheckedIndexedAccess, which would otherwise widen `content[0]` to
// `DocNode | undefined`. The assertions only ever read index `[0]`.
type NodeList = [DocNode, ...DocNode[]];
type DocNode = { type: string; content: NodeList; text?: string; marks?: unknown[] };
const asDoc = (j: Json): DocNode => j as unknown as DocNode;

const para = (...content: unknown[]): Json => ({ type: 'paragraph', content }) as unknown as Json;
const text = (t: string, mark?: { type: string; attrs: Record<string, unknown> }) =>
  ({
    type: 'text',
    text: t,
    ...(mark ? { marks: [mark] } : {}),
  }) as unknown as Json;
const ins = (id: string) => ({
  type: 'suggestionInsert',
  attrs: { suggestionId: id, authorId: 'u1', createdAt: 'x' },
});
const del = (id: string) => ({
  type: 'suggestionDelete',
  attrs: { suggestionId: id, authorId: 'u1', createdAt: 'x' },
});

describe('suggestion transform', () => {
  it('accept insert keeps text, drops the mark', () => {
    const doc = { type: 'doc', content: [para(text('a '), text('b', ins('s1')))] };
    const out = acceptSuggestion(doc, 's1');
    const run = asDoc(out).content[0].content;
    expect(run.map((n: Inline) => n.text).join('')).toBe('a b');
    expect(run.some((n: Inline) => n.marks?.length)).toBe(false);
  });
  it('reject insert removes the inserted text', () => {
    const doc = { type: 'doc', content: [para(text('a '), text('b', ins('s1')))] };
    const out = rejectSuggestion(doc, 's1');
    expect(
      asDoc(out)
        .content[0].content.map((n: Inline) => n.text)
        .join(''),
    ).toBe('a ');
  });
  it('accept delete removes the deleted text', () => {
    const doc = { type: 'doc', content: [para(text('keep '), text('gone', del('s2')))] };
    const out = acceptSuggestion(doc, 's2');
    expect(
      asDoc(out)
        .content[0].content.map((n: Inline) => n.text)
        .join(''),
    ).toBe('keep ');
  });
  it('reject delete keeps text, drops the mark', () => {
    const doc = { type: 'doc', content: [para(text('keep '), text('gone', del('s2')))] };
    const out = rejectSuggestion(doc, 's2');
    const run = asDoc(out).content[0].content;
    expect(run.map((n: Inline) => n.text).join('')).toBe('keep gone');
    expect(run.some((n: Inline) => n.marks?.length)).toBe(false);
  });
  it('accept suggestionBlock kind=insert unwraps children', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'suggestionBlock',
          attrs: { suggestionId: 's3', authorId: 'u1', createdAt: 'x', kind: 'insert' },
          content: [para(text('new'))],
        },
      ],
    };
    const out = acceptSuggestion(doc, 's3');
    expect(asDoc(out).content[0].type).toBe('paragraph');
    expect(asDoc(out).content[0].content[0].text).toBe('new');
  });
  it('reject suggestionBlock kind=insert removes the block', () => {
    const doc = {
      type: 'doc',
      content: [
        para(text('before')),
        {
          type: 'suggestionBlock',
          attrs: { suggestionId: 's3', authorId: 'u1', createdAt: 'x', kind: 'insert' },
          content: [para(text('new'))],
        },
      ],
    };
    const out = rejectSuggestion(doc, 's3');
    expect(asDoc(out).content).toHaveLength(1);
    expect(asDoc(out).content[0].content[0].text).toBe('before');
  });
  it('previewAccepted resolves every suggestion to clean text', () => {
    const doc = {
      type: 'doc',
      content: [para(text('a'), text('+', ins('s1')), text('-', del('s2')))],
    };
    const out = previewAccepted(doc);
    expect(
      asDoc(out)
        .content[0].content.map((n: Inline) => n.text)
        .join(''),
    ).toBe('a+');
    expect(JSON.stringify(out)).not.toContain('suggestion');
  });
  it('is a no-op for an unknown suggestionId', () => {
    const doc = { type: 'doc', content: [para(text('a', ins('s1')))] };
    expect(acceptSuggestion(doc, 'nope')).toEqual(doc);
  });
});
