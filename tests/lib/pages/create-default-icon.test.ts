import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_ICON } from '@/lib/pages/default-icon';
import { formatIcon, parseIcon } from '@/lib/pages/icon-format';

describe('new-page default icon (#83)', () => {
  it('is the neutral document emoji, not a random palette pick', () => {
    expect(DEFAULT_PAGE_ICON).toBe('📄');
  });

  it('round-trips through the icon-format prefix convention', () => {
    const stored = formatIcon({ kind: 'emoji', value: DEFAULT_PAGE_ICON });
    expect(stored).toBe('emoji::📄');
    expect(parseIcon(stored)).toEqual({ kind: 'emoji', value: '📄' });
  });
});
