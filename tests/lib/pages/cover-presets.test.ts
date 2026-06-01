// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { meetsAA } from '@/lib/color/contrast';
import {
  COVER_PRESETS,
  DEFAULT_COVER_PRESET_KEY,
  getCoverPreset,
  isCoverPresetKey,
} from '@/lib/pages/cover-presets';

// The page title sits on the theme --foreground (dark UI: hsl(0 0% 98%) ≈ #fafafa).
const TITLE_REFERENCE = '#fafafa';

describe('COVER_PRESETS registry', () => {
  it('exposes 7 gradients and 4 neutrals (11 total)', () => {
    const gradients = COVER_PRESETS.filter((p) => p.type === 'gradient');
    const neutrals = COVER_PRESETS.filter((p) => p.type === 'neutral');
    expect(gradients).toHaveLength(7);
    expect(neutrals).toHaveLength(4);
    expect(COVER_PRESETS).toHaveLength(11);
  });

  it('has unique, stable, slug-shaped keys', () => {
    const keys = COVER_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('gives every preset a non-empty css value and i18n nameKey', () => {
    for (const p of COVER_PRESETS) {
      expect(p.css.length).toBeGreaterThan(0);
      expect(p.nameKey).toMatch(/^cover\.preset\./);
      expect(p.solid).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('neutrals use backgroundColor (solid === css), gradients use backgroundImage', () => {
    for (const p of COVER_PRESETS) {
      if (p.type === 'neutral') {
        expect(p.css).toBe(p.solid);
      } else {
        expect(p.css.startsWith('linear-gradient(')).toBe(true);
      }
    }
  });

  it('every preset PASSES WCAG AA against the page-title color (finding U fix)', () => {
    // The whole point of the curated palette: no default/preset fails contrast.
    for (const p of COVER_PRESETS) {
      expect(meetsAA(p.solid, TITLE_REFERENCE)).toBe(true);
    }
  });

  it('the default preset key resolves to a real gradient preset', () => {
    const def = getCoverPreset(DEFAULT_COVER_PRESET_KEY);
    expect(def).not.toBeNull();
    expect(def?.type).toBe('gradient');
    // Must NOT be the old harsh solid orange.
    expect(def?.solid).not.toBe('#ea580c');
  });
});

describe('getCoverPreset / isCoverPresetKey', () => {
  it('looks up a known key', () => {
    expect(getCoverPreset('slate-dusk')?.key).toBe('slate-dusk');
  });

  it('returns null / false for unknown keys', () => {
    expect(getCoverPreset('totally-made-up')).toBeNull();
    expect(isCoverPresetKey('totally-made-up')).toBe(false);
    expect(isCoverPresetKey('slate-dusk')).toBe(true);
  });
});
