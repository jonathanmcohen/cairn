// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { CitationNode } from '@/components/editor/blocks/citation-node';

// Track + destroy editors so prosemirror-view's DOMObserver doesn't schedule a
// deferred flush (setTimeout) that fires after vitest tears down jsdom — that
// throws an uncaught `ReferenceError: document is not defined` which fails the
// whole run even though every assertion passed. Same fix as audio-node.test.tsx.
const editors: Editor[] = [];
const makeEditor = (opts: ConstructorParameters<typeof Editor>[0]) => {
  const e = new Editor(opts);
  editors.push(e);
  return e;
};

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
});

describe('CitationNode', () => {
  it('serializes all attrs through JSON', () => {
    const editor = makeEditor({ extensions: [StarterKit, CitationNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'citation',
          attrs: {
            id: 'c1',
            doi: '10.1/x',
            pubmed_id: null,
            formatted_apa: 'A apa',
            formatted_mla: 'A mla',
            formatted_chicago: 'A chi',
            raw_authors: ['Smith, J.'],
            raw_title: 't',
            raw_year: 2024,
          },
        },
      ],
    });
    const node = editor.getJSON().content?.[0];
    expect(node?.attrs?.id).toBe('c1');
    expect(node?.attrs?.raw_authors).toEqual(['Smith, J.']);
    expect(node?.attrs?.raw_year).toBe(2024);
  });

  // v0.10.2 P5 — the full CitationMeta is persisted on the node so the chip
  // popover renders from attrs alone (no re-lookup post-insert).
  it('round-trips the P5 meta attrs (journal/volume/issue/pages/url)', () => {
    const editor = makeEditor({ extensions: [StarterKit, CitationNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'citation',
          attrs: {
            id: 'c2',
            doi: '10.2/y',
            formatted_apa: 'B apa',
            raw_authors: ['Doe, J.'],
            raw_title: 'u',
            raw_year: 2025,
            journal: 'Nature Things',
            volume: '12',
            issue: '3',
            pages: '45-67',
            url: 'https://doi.org/10.2/y',
          },
        },
      ],
    });
    const node = editor.getJSON().content?.[0];
    expect(node?.attrs?.journal).toBe('Nature Things');
    expect(node?.attrs?.volume).toBe('12');
    expect(node?.attrs?.issue).toBe('3');
    expect(node?.attrs?.pages).toBe('45-67');
    expect(node?.attrs?.url).toBe('https://doi.org/10.2/y');
  });

  // Pre-P5 docs carry none of the new attrs — they must parse with null
  // defaults, not throw.
  it('parses pre-P5 nodes (missing meta attrs default to null)', () => {
    const editor = makeEditor({ extensions: [StarterKit, CitationNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'citation',
          attrs: { id: 'old1', formatted_apa: 'Old apa', raw_title: 'old', raw_year: 2020 },
        },
      ],
    });
    const node = editor.getJSON().content?.[0];
    expect(node?.attrs?.id).toBe('old1');
    expect(node?.attrs?.journal).toBeNull();
    expect(node?.attrs?.url).toBeNull();
  });
});
