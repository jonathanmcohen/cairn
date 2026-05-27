import { describe, expect, it } from 'vitest';
import { proseToMarkdown } from '@/lib/markdown/from-prose';

describe('markdown export — datetime', () => {
  it('emits <time> with datetime attr and node-tz formatted text', () => {
    const md = proseToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Meeting at ' },
            {
              type: 'datetime',
              attrs: {
                iso: '2026-05-26T15:00:00.000Z',
                tz: 'America/New_York',
                display_format: 'yyyy-LL-dd HH:mm',
              },
            },
            { type: 'text', text: '.' },
          ],
        },
      ],
    });
    expect(md).toContain('<time datetime="2026-05-26T15:00:00.000Z">2026-05-26 11:00</time>');
  });

  it('emits <time> using the node-supplied display_format', () => {
    const md = proseToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'datetime',
              attrs: {
                iso: '2026-12-25T00:00:00.000Z',
                tz: 'Pacific/Auckland',
                display_format: 'yyyy-LL-dd',
              },
            },
          ],
        },
      ],
    });
    expect(md).toContain('<time datetime="2026-12-25T00:00:00.000Z">2026-12-25</time>');
  });
});
