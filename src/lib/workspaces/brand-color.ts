/**
 * v0.10.0 F1 — workspace brand primary color: validation + WCAG contrast clamp.
 *
 * Pure functions, no deps. The theme tokens in globals.css are HSL CHANNEL
 * triplets consumed as `hsl(var(--primary))`, so the applied value must be an
 * HSL triplet string ("H S% L%"), not a raw hex — `hexToHslTriplet` does that
 * conversion. (The plan said "OKLCH-safe"; in this repo the OKLCH-equivalent
 * requirement is "valid inside `hsl(...)`", hence triplets.)
 *
 * Clamp approach (documented simplification): instead of converting to OKLCH
 * and reducing OKLCH-L, we reduce HSL lightness in deterministic 1% steps
 * until the WCAG 2.x contrast ratio against the on-primary foreground reaches
 * 4.5:1. Contrast is computed the standard way — hex → linear sRGB → relative
 * luminance. Darkening monotonically lowers luminance, and pure black against
 * the near-white foreground is ~20:1, so the loop always terminates ≥ 4.5:1.
 *
 * The brand wrapper pins `--primary-foreground` to `0 0% 98%` (#fafafa) in
 * BOTH light and dark mode (the inline style wins over the `.dark` block), so
 * a single clamp target covers both modes. #fafafa is slightly stricter than
 * pure white, so passing it also passes #ffffff.
 */

/** The on-primary foreground the brand wrapper pins: `0 0% 98%` = #fafafa. */
export const BRAND_PRIMARY_FOREGROUND_HEX = '#fafafa';

/** `--primary-foreground` HSL triplet the brand wrapper applies inline. */
export const BRAND_PRIMARY_FOREGROUND_HSL = '0 0% 98%';

const HEX_6 = /^#([0-9a-f]{6})$/i;

/**
 * Accept a `#rrggbb` hex string (the native color input's format) and return
 * it lowercased, or null when malformed. Strict 6-digit form only — shorthand
 * `#rgb`, alpha channels and named colors are rejected.
 */
export function normalizeHexColor(input: string): string | null {
  const m = HEX_6.exec(input.trim());
  return m ? `#${(m[1] as string).toLowerCase()}` : null;
}

type Rgb = { r: number; g: number; b: number };

function hexToRgb(hex: string): Rgb {
  const norm = normalizeHexColor(hex);
  if (!norm) throw new Error(`invalid hex color: ${hex}`);
  return {
    r: Number.parseInt(norm.slice(1, 3), 16),
    g: Number.parseInt(norm.slice(3, 5), 16),
    b: Number.parseInt(norm.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function srgbChannelToLinear(v255: number): number {
  const v = v255 / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` color (0 = black … 1 = white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colors (1 … 21). */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

type Hsl = { h: number; s: number; l: number };

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const hn = h / 360;
  return { r: hue(hn + 1 / 3) * 255, g: hue(hn) * 255, b: hue(hn - 1 / 3) * 255 };
}

/**
 * Convert a `#rrggbb` hex to the space-separated HSL channel triplet the theme
 * tokens expect (e.g. `#2563eb` → "217 91% 60%"), matching the named-accent
 * blocks in globals.css.
 */
export function hexToHslTriplet(hex: string): string {
  const { h, s, l } = rgbToHsl(hexToRgb(hex));
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return `${round1(h)} ${round1(s * 100)}% ${round1(l * 100)}%`;
}

export const MIN_PRIMARY_CONTRAST = 4.5;

export type ClampedPrimary = {
  /** `#rrggbb` hex that meets ≥ 4.5:1 against the on-primary foreground. */
  color: string;
  /** True when the input had to be darkened to pass. */
  clamped: boolean;
};

/**
 * Clamp a brand primary so near-white picks can never render unreadable white
 * text. Keeps hue + saturation, lowers HSL lightness in 1% steps until the
 * contrast against {@link BRAND_PRIMARY_FOREGROUND_HEX} is ≥ 4.5:1. Applied at
 * WRITE time (normalizing what we store is out of scope — we store the raw
 * pick) AND at READ time, so rows written by other paths still clamp at render.
 */
export function clampAccessiblePrimary(hex: string): ClampedPrimary {
  const norm = normalizeHexColor(hex);
  if (!norm) throw new Error(`invalid hex color: ${hex}`);
  if (contrastRatio(norm, BRAND_PRIMARY_FOREGROUND_HEX) >= MIN_PRIMARY_CONTRAST) {
    return { color: norm, clamped: false };
  }
  const hsl = rgbToHsl(hexToRgb(norm));
  let l = hsl.l;
  let candidate = norm;
  // 1% lightness steps; ≤ 100 iterations, and l=0 (black) is ~20:1 vs #fafafa.
  while (l > 0) {
    l = Math.max(0, l - 0.01);
    candidate = rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s, l }));
    if (contrastRatio(candidate, BRAND_PRIMARY_FOREGROUND_HEX) >= MIN_PRIMARY_CONTRAST) break;
  }
  return { color: candidate, clamped: true };
}
