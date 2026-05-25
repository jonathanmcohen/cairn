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

export type DefaultIcon = (typeof DEFAULT_ICONS)[number];

/** Pick one of DEFAULT_ICONS uniformly at random. */
export function randomDefaultIcon(): DefaultIcon {
  const i = Math.floor(Math.random() * DEFAULT_ICONS.length);
  return DEFAULT_ICONS[i] as DefaultIcon;
}
