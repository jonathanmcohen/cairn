/**
 * Theme presets — the only values `user_theme_prefs.accent`, `font_family`, and
 * `page_width` are allowed to take. The Drizzle column is plain `text` (no
 * pg-enum); validation happens via Zod schemas built here and used by the API
 * route + the client picker. Keeping them in one module means migrations stay
 * additive when we add a new accent — no SQL change, just append here.
 */

import { z } from 'zod';

/** Eight named accents + the custom-hex case. The named ones map to a
 * `[data-accent="<name>"]` CSS block in globals.css; the custom case sets
 * `--cairn-accent` directly to the hex value the user picked. */
export const ACCENT_PRESETS = [
  { id: 'default', label: 'Default', hex: '#0f172a' },
  { id: 'blue', label: 'Blue', hex: '#2563eb' },
  { id: 'indigo', label: 'Indigo', hex: '#4f46e5' },
  { id: 'violet', label: 'Violet', hex: '#7c3aed' },
  { id: 'rose', label: 'Rose', hex: '#e11d48' },
  { id: 'amber', label: 'Amber', hex: '#d97706' },
  { id: 'emerald', label: 'Emerald', hex: '#059669' },
  { id: 'slate', label: 'Slate', hex: '#475569' },
] as const;

export type AccentPreset = (typeof ACCENT_PRESETS)[number]['id'];

export const FONT_FAMILIES = ['system', 'serif', 'mono'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const PAGE_WIDTHS = ['narrow', 'wide', 'full'] as const;
export type PageWidth = (typeof PAGE_WIDTHS)[number];

/** Hex-color regex (#RGB / #RRGGBB) — matches the picker's custom-color path. */
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const ThemePrefsSchema = z.object({
  accent: z.union([
    z.enum(ACCENT_PRESETS.map((p) => p.id) as [AccentPreset, ...AccentPreset[]]),
    z.string().regex(HEX_RE),
  ]),
  fontFamily: z.enum(FONT_FAMILIES),
  pageWidth: z.enum(PAGE_WIDTHS),
});

export type ThemePrefs = z.infer<typeof ThemePrefsSchema>;

export const DEFAULT_THEME_PREFS: ThemePrefs = {
  accent: 'default',
  fontFamily: 'system',
  pageWidth: 'wide',
};

/** The max-width pixel values applied via the --cairn-page-width-max CSS var. */
export const PAGE_WIDTH_PX: Record<PageWidth, string> = {
  narrow: '720px',
  wide: '960px',
  full: '100%',
};

/** The font-stack values applied via the --cairn-font-family CSS var. */
export const FONT_FAMILY_STACK: Record<FontFamily, string> = {
  system:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};
