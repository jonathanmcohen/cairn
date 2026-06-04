import { describe, expect, it } from 'vitest';
import { isLegacyOrangeCover, LEGACY_ORANGE_HEXES } from '@/lib/pages/backfill-legacy-cover';

describe('isLegacyOrangeCover', () => {
  it('matches the legacy orange/amber color covers (case-insensitive)', () => {
    expect(isLegacyOrangeCover({ kind: 'color', value: '#ea580c' })).toBe(true);
    expect(isLegacyOrangeCover({ kind: 'color', value: '#EA580C' })).toBe(true);
    expect(isLegacyOrangeCover({ kind: 'color', value: '#d97706' })).toBe(true);
  });
  it('does not match curated presets, other colors, or empty covers', () => {
    expect(isLegacyOrangeCover({ kind: 'preset', value: 'ember-mute' })).toBe(false);
    expect(isLegacyOrangeCover({ kind: 'color', value: '#3366ff' })).toBe(false);
    expect(isLegacyOrangeCover({})).toBe(false);
  });
  it('exposes the canonical legacy hex list (lowercased)', () => {
    expect(LEGACY_ORANGE_HEXES).toEqual(['#ea580c', '#d97706']);
  });
});
