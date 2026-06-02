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
  it('exposes 9 gradients and 6 neutrals (15 total)', () => {
    const gradients = COVER_PRESETS.filter((p) => p.type === 'gradient');
    const neutrals = COVER_PRESETS.filter((p) => p.type === 'neutral');
    expect(gradients).toHaveLength(9);
    expect(neutrals).toHaveLength(6);
    expect(COVER_PRESETS).toHaveLength(15);
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

  it('the default preset key is exactly slate-dusk (finding C regression guard)', () => {
    expect(DEFAULT_COVER_PRESET_KEY).toBe('slate-dusk');
  });

  it('NO preset solid is an orange hue (finding C — orange removed for good)', () => {
    // Orange = hue ~20-50deg with meaningful saturation. Reject any such tone.
    for (const p of COVER_PRESETS) {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(p.solid);
      expect(m).not.toBeNull();
      if (!m) continue;
      const r = Number.parseInt(m[1] as string, 16) / 255;
      const g = Number.parseInt(m[2] as string, 16) / 255;
      const b = Number.parseInt(m[3] as string, 16) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      const sat = max === 0 ? 0 : delta / max;
      let hue = 0;
      if (delta !== 0) {
        if (max === r) hue = 60 * (((g - b) / delta) % 6);
        else if (max === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);
      }
      if (hue < 0) hue += 360;
      const isOrange = hue >= 20 && hue <= 50 && sat > 0.4;
      expect(isOrange, `${p.key} (${p.solid}) is orange`).toBe(false);
    }
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
