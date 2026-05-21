import { describe, expect, it } from 'vitest';
import { userColor } from '@/lib/collab/user-color';

describe('userColor', () => {
  it('is deterministic for the same id', () => {
    expect(userColor('user-abc')).toBe(userColor('user-abc'));
  });

  it('differs for different ids (no trivial collision on a small sample)', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => userColor(id)));
    // not a guarantee of perfect distribution, just that it isn't constant
    expect(colors.size).toBeGreaterThan(1);
  });

  it('returns an hsl() string', () => {
    expect(userColor('anything')).toMatch(/^hsl\(\d{1,3}, \d{1,3}%, \d{1,3}%\)$/);
  });

  it('handles empty string without throwing', () => {
    expect(() => userColor('')).not.toThrow();
  });
});
