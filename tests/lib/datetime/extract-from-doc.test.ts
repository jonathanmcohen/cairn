import { describe, expect, it } from 'vitest';
import { extractDateTimesFromDoc } from '@/lib/datetime/extract-from-doc';

describe('extractDateTimesFromDoc', () => {
  it('collects all datetime nodes in document order', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'datetime', attrs: { iso: '2026-01-01T00:00:00Z', tz: 'UTC' } },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'datetime', attrs: { iso: '2026-02-01T00:00:00Z', tz: 'UTC' } },
          ],
        },
      ],
    };
    const dts = extractDateTimesFromDoc(doc);
    expect(dts.map((d) => d.iso)).toEqual([
      '2026-01-01T00:00:00Z',
      '2026-02-01T00:00:00Z',
    ]);
  });

  it('returns ms-epoch values suitable for range filters', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'datetime',
              attrs: { iso: '2026-05-26T15:00:00.000Z', tz: 'America/New_York' },
            },
          ],
        },
      ],
    };
    const dts = extractDateTimesFromDoc(doc);
    expect(dts).toHaveLength(1);
    expect(dts[0]?.epochMs).toBe(Date.UTC(2026, 4, 26, 15, 0, 0));
    expect(dts[0]?.tz).toBe('America/New_York');
  });

  it('returns empty array for docs with no datetime', () => {
    expect(
      extractDateTimesFromDoc({ type: 'doc', content: [{ type: 'paragraph' }] }),
    ).toEqual([]);
  });

  it('skips invalid ISO strings', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'datetime', attrs: { iso: 'not-an-iso', tz: 'UTC' } }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'datetime', attrs: { iso: '2026-02-01T00:00:00Z', tz: 'UTC' } },
          ],
        },
      ],
    };
    const dts = extractDateTimesFromDoc(doc);
    expect(dts).toHaveLength(1);
    expect(dts[0]?.iso).toBe('2026-02-01T00:00:00Z');
  });
});
