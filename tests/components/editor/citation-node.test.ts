// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { CitationNode } from '@/components/editor/blocks/citation-node';

describe('CitationNode', () => {
  it('serializes all attrs through JSON', () => {
    const editor = new Editor({ extensions: [StarterKit, CitationNode] });
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
