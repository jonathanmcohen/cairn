import { describe, expect, it } from 'vitest';
import { aggregateCitations } from '@/lib/citations/aggregate';

describe('aggregateCitations', () => {
  it('dedups by id, preserves first-appearance order', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'citation', attrs: { id: 'c1', formatted_apa: 'A 2024.' } },
        { type: 'citation', attrs: { id: 'c2', formatted_apa: 'B 2024.' } },
        { type: 'citation', attrs: { id: 'c1', formatted_apa: 'A 2024.' } },
      ],
    };
    const refs = aggregateCitations(doc, 'apa');
    expect(refs.map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(refs[0]!.formatted).toBe('A 2024.');
  });

  it('picks style-specific formatted string', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'citation',
          attrs: {
            id: 'c1',
            formatted_apa: 'A apa',
            formatted_mla: 'A mla',
            formatted_chicago: 'A chi',
          },
        },
      ],
    };
    expect(aggregateCitations(doc, 'mla')[0]!.formatted).toBe('A mla');
    expect(aggregateCitations(doc, 'chicago')[0]!.formatted).toBe('A chi');
  });
});
