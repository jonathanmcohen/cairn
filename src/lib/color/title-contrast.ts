/**
 * Resolve the *effective* page-title foreground color for the cover contrast
 * heuristic (finding C). The page title overlays the cover on the theme
 * `--foreground` token, which differs between light and dark themes — so the
 * custom-hex warning must compare against the real resolved color, not a
 * hardcoded `#fafafa`.
 *
 * Accepts whatever `getComputedStyle(...).getPropertyValue('--foreground')`
 * (or `color`) yields across browsers — a `#hex`, an `"R G B"` channel triple
 * (Tailwind v4 CSS-var form), or an `rgb(r, g, b)` string — and normalizes to
 * a `#rrggbb` hex. Pure: no DOM access, safe for node-env unit tests. Callers
 * read the computed value in the client component and pass it in.
 */

const DARK_FOREGROUND = '#fafafa';
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function clampChannel(n: number): number {
  if (Number.isNaN(n)) return Number.NaN;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r: number, g: number, b: number): string | null {
  const rr = clampChannel(r);
  const gg = clampChannel(g);
  const bb = clampChannel(b);
  if (Number.isNaN(rr) || Number.isNaN(gg) || Number.isNaN(bb)) return null;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(rr)}${h(gg)}${h(bb)}`;
}

export function resolveTitleForeground(computed: string | undefined | null): string {
  if (!computed) return DARK_FOREGROUND;
  const value = computed.trim();
  if (value.length === 0) return DARK_FOREGROUND;

  if (HEX_RE.test(value)) return value;

  // "rgb(17, 24, 39)" or "rgba(17, 24, 39, 1)"
  const rgbMatch = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(value);
  if (rgbMatch) {
    const hex = toHex(Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3]));
    if (hex) return hex;
  }

  // Tailwind v4 CSS-var channel form: "250 250 250"
  const channelMatch = /^([\d.]+)\s+([\d.]+)\s+([\d.]+)$/.exec(value);
  if (channelMatch) {
    const hex = toHex(Number(channelMatch[1]), Number(channelMatch[2]), Number(channelMatch[3]));
    if (hex) return hex;
  }

  return DARK_FOREGROUND;
}
