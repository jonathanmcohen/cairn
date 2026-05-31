// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsAA, parseHex, relativeLuminance } from '@/lib/color/contrast';

describe('parseHex', () => {
  it('parses 6-digit hex', () => {
    expect(parseHex('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHex('#ea580c')).toEqual({ r: 234, g: 88, b: 12 });
  });

  it('expands 3-digit shorthand', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#0a0')).toEqual({ r: 0, g: 170, b: 0 });
  });

  it('is case-insensitive', () => {
    expect(parseHex('#EA580C')).toEqual({ r: 234, g: 88, b: 12 });
  });

  it('returns null for non-hex input', () => {
    expect(parseHex('rebeccapurple')).toBeNull();
    expect(parseHex('#12')).toBeNull();
    expect(parseHex('linear-gradient(...)')).toBeNull();
    expect(parseHex('')).toBeNull();
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it('matches the WCAG reference for mid-grey #808080', () => {
    // sRGB 0.5019 → linearized ≈ 0.2159 for all channels.
    expect(relativeLuminance({ r: 128, g: 128, b: 128 })).toBeCloseTo(0.2159, 3);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('is 1:1 for identical colors', () => {
    expect(contrastRatio('#3b82f6', '#3b82f6')).toBeCloseTo(1, 5);
  });

  it('is symmetric (order does not matter)', () => {
    expect(contrastRatio('#ea580c', '#fafafa')).toBeCloseTo(
      contrastRatio('#fafafa', '#ea580c'),
      5,
    );
  });

  it('flags solid orange #ea580c against near-white #fafafa as below 4.5:1', () => {
    // This is the finding-U/Y motivating case: the old default cover fails AA.
    expect(contrastRatio('#ea580c', '#fafafa')).toBeLessThan(4.5);
  });

  it('returns 1 when either color is unparseable (fail-open, no throw)', () => {
    expect(contrastRatio('not-a-color', '#ffffff')).toBe(1);
  });
});

describe('meetsAA', () => {
  it('passes a dark slate against near-white', () => {
    expect(meetsAA('#0f172a', '#fafafa')).toBe(true);
  });

  it('fails solid orange against near-white', () => {
    expect(meetsAA('#ea580c', '#fafafa')).toBe(false);
  });

  it('honours the large-text 3:1 threshold when largeText=true', () => {
    // A color that is between 3:1 and 4.5:1 against the reference.
    const ratio = contrastRatio('#7b8290', '#fafafa');
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(4.5);
    expect(meetsAA('#7b8290', '#fafafa')).toBe(false);
    expect(meetsAA('#7b8290', '#fafafa', { largeText: true })).toBe(true);
  });
});
