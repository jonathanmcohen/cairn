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
});
