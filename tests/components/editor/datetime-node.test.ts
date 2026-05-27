// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { DateTimeNode } from '@/components/editor/blocks/datetime-node';

describe('DateTimeNode', () => {
  it('serializes all three attrs through JSON', () => {
    const editor = new Editor({ extensions: [StarterKit, DateTimeNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'datetime',
              attrs: {
                iso: '2026-05-26T15:00:00.000Z',
                tz: 'America/New_York',
                display_format: 'yyyy-LL-dd HH:mm',
              },
            },
          ],
        },
      ],
    });
    const para = editor.getJSON().content?.[0] as {
      content?: { attrs?: Record<string, unknown> }[];
    };
    const node = para.content?.[0];
    expect(node?.attrs?.iso).toBe('2026-05-26T15:00:00.000Z');
    expect(node?.attrs?.tz).toBe('America/New_York');
    expect(node?.attrs?.display_format).toBe('yyyy-LL-dd HH:mm');
  });

  it('applies default display_format', () => {
    const editor = new Editor({ extensions: [StarterKit, DateTimeNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'datetime', attrs: { iso: '2026-05-26T15:00:00Z', tz: 'UTC' } }],
        },
      ],
    });
    const para = editor.getJSON().content?.[0] as {
      content?: { attrs?: Record<string, unknown> }[];
    };
    expect(para.content?.[0]?.attrs?.display_format).toBe('yyyy-LL-dd HH:mm');
  });

  it('renders to HTML as a <time> with datetime + data-* attrs', () => {
    const editor = new Editor({ extensions: [StarterKit, DateTimeNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'datetime',
              attrs: {
                iso: '2026-05-26T15:00:00.000Z',
                tz: 'America/New_York',
                display_format: 'yyyy-LL-dd HH:mm',
              },
            },
          ],
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain('datetime="2026-05-26T15:00:00.000Z"');
    expect(html).toContain('data-tz="America/New_York"');
    expect(html).toContain('data-format="yyyy-LL-dd HH:mm"');
  });
});
