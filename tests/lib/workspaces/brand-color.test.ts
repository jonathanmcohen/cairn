import { describe, expect, it } from 'vitest';
import {
  BRAND_PRIMARY_FOREGROUND_HEX,
  clampAccessiblePrimary,
  contrastRatio,
  hexToHslTriplet,
  MIN_PRIMARY_CONTRAST,
  normalizeHexColor,
  relativeLuminance,
} from '@/lib/workspaces/brand-color';

// Independent WCAG contrast implementation so the clamp test does not trust
// the unit under test for its own acceptance criterion.
function independentContrast(hexA: string, hexB: string): number {
  const lum = (hex: string): number => {
    const chan = (i: number) => {
      const v = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
  };
  const a = lum(hexA);
  const b = lum(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('normalizeHexColor', () => {
  it('accepts #rrggbb and lowercases', () => {
    expect(normalizeHexColor('#2563EB')).toBe('#2563eb');
    expect(normalizeHexColor('  #a1B2c3 ')).toBe('#a1b2c3');
  });

  it('rejects everything that is not a 6-digit hex', () => {
    for (const bad of [
      '',
      '#fff', // shorthand rejected
      '2563eb', // missing '#'
      '#2563ebff', // alpha rejected
      '#GGGGGG',
      'rebeccapurple',
      'rgb(1,2,3)',
      'hsl(217 91% 60%)',
      '#12345',
      "#123456'); DROP TABLE workspaces;--",
    ]) {
      expect(normalizeHexColor(bad)).toBeNull();
    }
  });
});

describe('relativeLuminance / contrastRatio', () => {
  it('matches WCAG reference values', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    // Black on white is the canonical 21:1.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    // Symmetric.
    expect(contrastRatio('#2563eb', '#fafafa')).toBeCloseTo(
      contrastRatio('#fafafa', '#2563eb'),
      10,
    );
  });
});

describe('hexToHslTriplet', () => {
  it('produces the globals.css channel format', () => {
    // Exact conversion of #2563eb = rgb(37, 99, 235) (hand-computed).
    expect(hexToHslTriplet('#2563eb')).toBe('221.2 83.2% 53.3%');
    expect(hexToHslTriplet('#000000')).toBe('0 0% 0%');
    expect(hexToHslTriplet('#ffffff')).toBe('0 0% 100%');
  });
});

describe('clampAccessiblePrimary', () => {
  it('passes an already-accessible color through unclamped', () => {
    // Dark slate — the default accent (#0f172a) is ~15:1 vs near-white.
    const r = clampAccessiblePrimary('#0f172a');
    expect(r).toEqual({ color: '#0f172a', clamped: false });
  });

  it('clamps a near-white pick to >= 4.5:1 (computed independently)', () => {
    const r = clampAccessiblePrimary('#f5f5f5');
    expect(r.clamped).toBe(true);
    expect(r.color).not.toBe('#f5f5f5');
    expect(independentContrast(r.color, BRAND_PRIMARY_FOREGROUND_HEX)).toBeGreaterThanOrEqual(
      MIN_PRIMARY_CONTRAST,
    );
  });

  it('clamps a saturated mid-tone while keeping it non-black', () => {
    // Bright yellow fails badly against near-white text.
    const r = clampAccessiblePrimary('#fde047');
    expect(r.clamped).toBe(true);
    expect(independentContrast(r.color, '#fafafa')).toBeGreaterThanOrEqual(4.5);
    expect(r.color).not.toBe('#000000');
  });

  it('even pure white terminates and lands accessible', () => {
    const r = clampAccessiblePrimary('#ffffff');
    expect(r.clamped).toBe(true);
    expect(independentContrast(r.color, '#fafafa')).toBeGreaterThanOrEqual(4.5);
  });

  it('is deterministic', () => {
    expect(clampAccessiblePrimary('#f5f5f5')).toEqual(clampAccessiblePrimary('#f5f5f5'));
  });

  it('rejects invalid input', () => {
    expect(() => clampAccessiblePrimary('#fff')).toThrow(/invalid hex/);
    expect(() => clampAccessiblePrimary('blue')).toThrow(/invalid hex/);
  });
});
