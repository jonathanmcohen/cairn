import { describe, expect, it } from 'vitest';
import { TRIGGER_EVENTS } from '@/lib/automation/dispatcher';
import { samplePayloadFor } from '@/lib/automation/sample-payloads';

describe('samplePayloadFor', () => {
  it('returns a payload for every trigger event', () => {
    for (const ev of TRIGGER_EVENTS) {
      const p = samplePayloadFor(ev);
      expect(p).toBeTypeOf('object');
      expect(p).not.toBeNull();
    }
  });

  it('row events carry a row object with cells', () => {
    const p = samplePayloadFor('row.created') as { row?: { id?: string; cells?: unknown } };
    expect(typeof p.row?.id).toBe('string');
    expect(p.row?.cells).toBeTypeOf('object');
  });

  it('page events carry a page object with a title', () => {
    const p = samplePayloadFor('page.updated') as { page?: { title?: string } };
    expect(typeof p.page?.title).toBe('string');
  });

  it('comment.created carries a comment body', () => {
    const p = samplePayloadFor('comment.created') as { comment?: { body?: string } };
    expect(typeof p.comment?.body).toBe('string');
  });
});
