/**
 * Curated 32-emoji palette for new pages. Chosen for breadth + cross-platform
 * rendering (no skin-tone variants, no flag emojis, no exotic glyphs that fall
 * back to tofu in older fonts).
 */
export const DEFAULT_ICONS = [
  '📘',
  '📗',
  '📕',
  '📙',
  '📒',
  '📓',
  '📔',
  '📑',
  '📝',
  '📌',
  '📎',
  '🔖',
  '🗂️',
  '🗒️',
  '🗓️',
  '📅',
  '🧭',
  '🧩',
  '🧪',
  '🧰',
  '✨',
  '⭐',
  '💡',
  '🔥',
  '🌱',
  '🍀',
  '🌿',
  '🪴',
  '🏔️',
  '🌊',
  '🌅',
  '🌌',
] as const;

/**
 * v0.9.4 #83 — the neutral default icon assigned at page-create time. Audit
 * feedback: a *random* emoji on every new page reads as noise / accidental.
 * A plain document glyph is calm and signals "untitled page". The curated
 * `DEFAULT_ICONS` palette + `randomDefaultIcon()` below stay for the icon
 * picker's "surprise me" affordance — only the create-time default changed.
 */
export const DEFAULT_PAGE_ICON = '📄';

export type DefaultIcon = (typeof DEFAULT_ICONS)[number];

/** Pick one of DEFAULT_ICONS uniformly at random. */
export function randomDefaultIcon(): DefaultIcon {
  const i = Math.floor(Math.random() * DEFAULT_ICONS.length);
  return DEFAULT_ICONS[i] as DefaultIcon;
}
