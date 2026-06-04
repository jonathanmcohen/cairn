import { describe, expect, it } from 'vitest';
import { buildTemplatePreview } from '@/lib/templates/preview';

describe('buildTemplatePreview', () => {
  it('walks page content into a flat ordered block list', () => {
    const payload = {
      kind: 'page',
      rootPageId: 'p1',
      pages: [
        {
          id: 'p1',
          parentId: null,
          title: 'Meeting notes',
          icon: null,
          content: {
            type: 'doc',
            content: [
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Agenda' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Notes go here' }] },
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
        },
      ],
      databases: [],
    };
    const preview = buildTemplatePreview(payload);
    expect(preview.kind).toBe('page');
    expect(preview.name).toBe('');
    expect(preview.blocks).toEqual([
      { kind: 'page', text: 'Meeting notes' },
      { kind: 'heading', level: 2, text: 'Agenda' },
      { kind: 'paragraph', text: 'Notes go here' },
      { kind: 'list', text: 'one' },
    ]);
  });

  it('summarises a database payload by its database name', () => {
    const payload = {
      kind: 'database',
      rootDatabaseId: 'd1',
      pages: [],
      databases: [
        {
          id: 'd1',
          name: 'Tasks',
          properties: [],
          views: [],
          rows: [],
        },
      ],
    };
    const preview = buildTemplatePreview(payload);
    expect(preview.kind).toBe('database');
    expect(preview.blocks).toEqual([{ kind: 'database', text: 'Tasks' }]);
  });

  it('emits a leading page header per page and truncates long text to 140 chars', () => {
    const long = 'x'.repeat(300);
    const payload = {
      kind: 'page',
      pages: [
        {
          id: 'p1',
          parentId: null,
          title: 'A',
          icon: null,
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: long }] }],
          },
        },
        {
          id: 'p2',
          parentId: null,
          title: 'B',
          icon: null,
          content: { type: 'doc', content: [] },
        },
      ],
      databases: [],
    };
    const preview = buildTemplatePreview(payload);
    expect(preview.blocks[0]).toEqual({ kind: 'page', text: 'A' });
    const para = preview.blocks[1] as { kind: 'paragraph'; text: string };
    expect(para.kind).toBe('paragraph');
    expect(para.text.length).toBe(140);
    // second page contributes its own header
    expect(preview.blocks.some((b) => b.kind === 'page' && b.text === 'B')).toBe(true);
  });

  it('captures callouts and skips empty/unknown nodes without throwing', () => {
    const payload = {
      kind: 'page',
      pages: [
        {
          id: 'p1',
          parentId: null,
          title: 'A',
          icon: null,
          content: {
            type: 'doc',
            content: [
              {
                type: 'callout',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Heads up' }] }],
              },
              { type: 'paragraph' },
              { type: 'someUnknownBlock', content: [{ type: 'text', text: 'ignored' }] },
            ],
          },
        },
      ],
      databases: [],
    };
    const preview = buildTemplatePreview(payload);
    expect(preview.blocks).toEqual([
      { kind: 'page', text: 'A' },
      { kind: 'callout', text: 'Heads up' },
    ]);
  });
});
