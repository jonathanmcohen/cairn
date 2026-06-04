import { describe, expect, it } from 'vitest';
import { OPERATIONS_DOCS_URL } from '@/lib/docs-links';

describe('docs links (#268)', () => {
  it('points operations.md at the GitHub blob URL (clickable, not a bare path)', () => {
    expect(OPERATIONS_DOCS_URL).toBe(
      'https://github.com/jonathanmcohen/cairn/blob/main/docs/operations.md',
    );
    expect(OPERATIONS_DOCS_URL.startsWith('https://')).toBe(true);
  });
});
