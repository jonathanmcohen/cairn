import { describe, expect, it } from 'vitest';
import { databaseToCsv, databaseToJson, pageToJson, pageToMarkdown } from '@/lib/export/renderers';

const page = {
  id: 'p1',
  title: 'Hello',
  content: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Body text.' }] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
          },
        ],
      },
    ],
  },
};

describe('export renderers', () => {
  it('pageToMarkdown renders headings, paragraphs, and lists', () => {
    const md = pageToMarkdown(page);
    expect(md).toContain('# Title');
    expect(md).toContain('Body text.');
    expect(md).toMatch(/^[-*] one$/m);
  });

  it('pageToJson is the raw ProseMirror doc plus metadata', () => {
    const json = pageToJson(page);
    expect(json).toMatchObject({ id: 'p1', title: 'Hello', content: page.content });
  });

  it('databaseToCsv emits a header row + one row per record, escaping commas/quotes', () => {
    const db = {
      id: 'd1',
      name: 'Tasks',
      properties: [
        { id: 'pa', name: 'Name', type: 'text' },
        { id: 'pb', name: 'Note', type: 'text' },
      ],
      rows: [
        { id: 'r1', cells: { pa: 'Buy milk', pb: 'two, please' } },
        { id: 'r2', cells: { pa: 'Say "hi"', pb: '' } },
      ],
    };
    const csv = databaseToCsv(db);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Name,Note');
    expect(lines[1]).toBe('Buy milk,"two, please"');
    expect(lines[2]).toBe('"Say ""hi""",');
  });

  it('databaseToJson includes schema + rows', () => {
    const db = {
      id: 'd1',
      name: 'T',
      properties: [{ id: 'pa', name: 'N', type: 'text' }],
      rows: [],
    };
    expect(databaseToJson(db)).toMatchObject({
      id: 'd1',
      name: 'T',
      properties: db.properties,
      rows: [],
    });
  });
});
