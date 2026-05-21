import { describe, expect, it } from 'vitest';
import { proseToMarkdown } from '@/lib/markdown/from-prose';
import { markdownToProse } from '@/lib/markdown/to-prose';

describe('proseToMarkdown', () => {
  it('renders a paragraph', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    });
    expect(out.trim()).toBe('hello');
  });

  it('renders a heading', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      ],
    });
    expect(out.trim()).toBe('## Title');
  });

  it('renders bullet list', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
            },
          ],
        },
      ],
    });
    expect(out.trim()).toBe('- A\n- B');
  });

  it('renders code block with language', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    });
    expect(out.trim()).toBe('```ts\nconst x = 1;\n```');
  });

  it('renders bold + italic marks', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'A', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'B', marks: [{ type: 'italic' }] },
          ],
        },
      ],
    });
    expect(out.trim()).toBe('**A** *B*');
  });

  it('renders image as ![alt](src)', () => {
    const out = proseToMarkdown({
      type: 'doc',
      content: [{ type: 'cairnImage', attrs: { alt: 'cat', src: '/api/files/x' } }],
    });
    expect(out.trim()).toBe('![cat](/api/files/x)');
  });
});

describe('markdownToProse', () => {
  it('imports H1 + paragraph', () => {
    const doc = markdownToProse('# Title\n\nSome text');
    expect(doc.content?.[0]?.type).toBe('heading');
    expect(doc.content?.[1]?.type).toBe('paragraph');
  });

  it('imports a code block with language', () => {
    const doc = markdownToProse('```ts\nconst x = 1;\n```');
    expect(doc.content?.[0]).toMatchObject({
      type: 'codeBlock',
      attrs: { language: 'ts' },
    });
  });

  it('imports a bullet list', () => {
    const doc = markdownToProse('- A\n- B');
    expect(doc.content?.[0]?.type).toBe('bulletList');
  });
});
