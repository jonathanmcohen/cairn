import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ICONS, randomDefaultIcon } from '@/lib/pages/default-icon';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('randomDefaultIcon', () => {
  it('returns a value from the curated 32-emoji set', () => {
    for (let i = 0; i < 100; i += 1) {
      const picked = randomDefaultIcon();
      expect(DEFAULT_ICONS).toContain(picked);
    }
  });

  it('exposes exactly 32 distinct emojis', () => {
    expect(DEFAULT_ICONS).toHaveLength(32);
    expect(new Set(DEFAULT_ICONS).size).toBe(32);
  });

  it('picks every emoji eventually (covers the whole set over enough draws)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) seen.add(randomDefaultIcon());
    // With 32 buckets + 2000 draws, the chance of any single bucket missing is
    // ~negligible (~10^-27). If this ever flakes we'll re-seed; meanwhile the
    // assertion catches a regression where the function silently picks from a
    // smaller subset (e.g. off-by-one in the modulo).
    expect(seen.size).toBe(32);
  });

  it('honors Math.random for determinism with a fixed mock', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // → index 0
    expect(randomDefaultIcon()).toBe(DEFAULT_ICONS[0]);
    vi.spyOn(Math, 'random').mockReturnValue(0.999_999); // → last index
    expect(randomDefaultIcon()).toBe(DEFAULT_ICONS[DEFAULT_ICONS.length - 1]);
  });
});
