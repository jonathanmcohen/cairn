/**
 * Pure WCAG 2.1 contrast helpers (finding Y). No React, no DOM — safe to import
 * from server components, client components, and node-env unit tests alike.
 *
 * Reference: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 * - relative luminance L = 0.2126*R + 0.7152*G + 0.0722*B, each channel
 *   linearized from sRGB.
 * - contrast ratio = (L_lighter + 0.05) / (L_darker + 0.05), 1..21.
 * - AA body text needs >= 4.5:1; AA large text needs >= 3:1.
 */

export type Rgb = { r: number; g: number; b: number };

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse a #rgb or #rrggbb hex string to 0-255 channels, or `null` if invalid. */
export function parseHex(hex: string): Rgb | null {
  if (!HEX_RE.test(hex)) return null;
  let body = hex.slice(1);
  if (body.length === 3) {
    body = body
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return {
    r: Number.parseInt(body.slice(0, 2), 16),
    g: Number.parseInt(body.slice(2, 4), 16),
    b: Number.parseInt(body.slice(4, 6), 16),
  };
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0 = black, 1 = white) of an sRGB color. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * WCAG contrast ratio between two hex colors (1..21). Symmetric. Fail-open:
 * returns 1 (worst case) rather than throwing when either input is unparseable,
 * so a stray non-hex value (e.g. a gradient string) never crashes a render.
 */
export function contrastRatio(a: string, b: string): number {
  const rgbA = parseHex(a);
  const rgbB = parseHex(b);
  if (!rgbA || !rgbB) return 1;
  const la = relativeLuminance(rgbA);
  const lb = relativeLuminance(rgbB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** True when `fg` vs `bg` meets WCAG AA (4.5:1 body, 3:1 large text). */
export function meetsAA(
  fg: string,
  bg: string,
  opts: { largeText?: boolean } = {},
): boolean {
  return contrastRatio(fg, bg) >= (opts.largeText ? 3 : 4.5);
}
