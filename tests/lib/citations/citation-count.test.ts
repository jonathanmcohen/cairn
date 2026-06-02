// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { aggregateCitations } from '@/lib/citations/aggregate';

const cite = (id: string) => ({
  type: 'citation',
  attrs: { id, formatted_apa: `APA ${id}`, formatted_mla: '', formatted_chicago: '' },
});

describe('citation count derivation (finding D)', () => {
  it('is 0 for a doc with no citation nodes', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(aggregateCitations(doc, 'apa')).toHaveLength(0);
  });

  it('counts each unique citation id once (dedup)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [cite('a'), cite('b')] },
        { type: 'paragraph', content: [cite('a')] }, // duplicate id
      ],
    };
    expect(aggregateCitations(doc, 'apa')).toHaveLength(2);
  });

  it('walks nested block content', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [cite('x'), cite('y'), cite('z')] }],
        },
      ],
    };
    expect(aggregateCitations(doc, 'apa')).toHaveLength(3);
  });
});
