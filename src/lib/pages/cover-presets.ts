/**
 * Curated cover palette (finding U). Replaces the harsh solid-orange default
 * with soft gradients + muted neutrals tuned for Cairn's dark UI.
 *
 * Covers are stored as a STABLE key (`{ kind: 'preset'; value: <key> }`), never
 * a raw hex the user can mis-pick — so the rendered look is owned by the design
 * system and can be retuned later without rewriting stored data.
 *
 * `solid` is a representative tone used only by the contrast heuristic
 * (finding Y) — for gradients it is the lighter stop, which is the worst case
 * against the near-white page title. Every preset is curated to pass WCAG AA
 * (asserted in `tests/lib/pages/cover-presets.test.ts`).
 */

export type CoverPresetType = 'gradient' | 'neutral';

export type CoverPreset = {
  /** Stable id persisted in `pages.cover.value`. */
  key: string;
  type: CoverPresetType;
  /** CSS value: `backgroundImage` for gradients, `backgroundColor` for neutrals. */
  css: string;
  /** Representative solid tone for the contrast heuristic. */
  solid: string;
  /** i18n message key for the swatch's accessible name. */
  nameKey: string;
};

export const COVER_PRESETS: readonly CoverPreset[] = [
  // --- Gradients (soft, desaturated; lighter stop kept dark enough for AA) ---
  {
    key: 'slate-dusk',
    type: 'gradient',
    css: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    solid: '#1e293b',
    nameKey: 'cover.preset.slateDusk',
  },
  {
    key: 'indigo-night',
    type: 'gradient',
    css: 'linear-gradient(135deg, #312e81 0%, #1e1b4b 100%)',
    solid: '#312e81',
    nameKey: 'cover.preset.indigoNight',
  },
  {
    key: 'teal-deep',
    type: 'gradient',
    css: 'linear-gradient(135deg, #134e4a 0%, #042f2e 100%)',
    solid: '#134e4a',
    nameKey: 'cover.preset.tealDeep',
  },
  {
    key: 'plum-haze',
    type: 'gradient',
    css: 'linear-gradient(135deg, #4a154b 0%, #2e0f33 100%)',
    solid: '#4a154b',
    nameKey: 'cover.preset.plumHaze',
  },
  {
    key: 'forest-shade',
    type: 'gradient',
    css: 'linear-gradient(135deg, #14532d 0%, #052e16 100%)',
    solid: '#14532d',
    nameKey: 'cover.preset.forestShade',
  },
  {
    key: 'ember-mute',
    type: 'gradient',
    css: 'linear-gradient(135deg, #7c2d12 0%, #431407 100%)',
    solid: '#7c2d12',
    nameKey: 'cover.preset.emberMute',
  },
  {
    key: 'ocean-fade',
    type: 'gradient',
    css: 'linear-gradient(135deg, #0c4a6e 0%, #082f49 100%)',
    solid: '#0c4a6e',
    nameKey: 'cover.preset.oceanFade',
  },
  {
    key: 'rose-quartz',
    type: 'gradient',
    css: 'linear-gradient(135deg, #831843 0%, #500724 100%)',
    solid: '#831843',
    nameKey: 'cover.preset.roseQuartz',
  },
  {
    key: 'cobalt-fade',
    type: 'gradient',
    css: 'linear-gradient(135deg, #1e3a8a 0%, #172554 100%)',
    solid: '#1e3a8a',
    nameKey: 'cover.preset.cobaltFade',
  },
  // --- Muted neutrals (css === solid) ---
  {
    key: 'graphite',
    type: 'neutral',
    css: '#1f2937',
    solid: '#1f2937',
    nameKey: 'cover.preset.graphite',
  },
  {
    key: 'stone',
    type: 'neutral',
    css: '#292524',
    solid: '#292524',
    nameKey: 'cover.preset.stone',
  },
  {
    key: 'midnight',
    type: 'neutral',
    css: '#0f172a',
    solid: '#0f172a',
    nameKey: 'cover.preset.midnight',
  },
  {
    key: 'slate',
    type: 'neutral',
    css: '#334155',
    solid: '#334155',
    nameKey: 'cover.preset.slate',
  },
  {
    key: 'charcoal',
    type: 'neutral',
    css: '#18181b',
    solid: '#18181b',
    nameKey: 'cover.preset.charcoal',
  },
  {
    key: 'walnut',
    type: 'neutral',
    css: '#3f3f46',
    solid: '#3f3f46',
    nameKey: 'cover.preset.walnut',
  },
] as const;

/** The cover applied by default when none is curated — soft slate, AA-safe. */
export const DEFAULT_COVER_PRESET_KEY = 'slate-dusk';

const BY_KEY = new Map(COVER_PRESETS.map((p) => [p.key, p]));

export function getCoverPreset(key: string): CoverPreset | null {
  return BY_KEY.get(key) ?? null;
}

export function isCoverPresetKey(key: string): boolean {
  return BY_KEY.has(key);
}
