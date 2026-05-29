import { getShortcuts } from './registry';

/**
 * SSR-safe platform check. Guards `navigator` so it returns false during
 * server render (the palette/sheet are client-only, but the import graph is
 * shared and must not throw on the server).
 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  // navigator.platform is deprecated but still the most reliable mac signal in
  // browsers; fall back to userAgent for engines that have emptied platform.
  const platform = navigator.platform || '';
  if (platform) return /Mac|iPhone|iPad|iPod/i.test(platform);
  const ua = navigator.userAgent || '';
  return /Mac|iPhone|iPad|iPod/i.test(ua);
}

/**
 * Render a registry `keys` string (e.g. "Mod+Shift+F") for display.
 * macOS: glyphs with no separator (⌘⇧F). Other platforms: Ctrl+Shift+F.
 */
export function prettyKeys(keys: string): string {
  const mac = isMac();
  const parts = keys
    .split('+')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const rendered = parts.map((part) => {
    const lower = part.toLowerCase();
    if (lower === 'mod') return mac ? '⌘' : 'Ctrl';
    if (lower === 'shift') return mac ? '⇧' : 'Shift';
    if (lower === 'alt') return mac ? '⌥' : 'Alt';
    return part.toUpperCase();
  });
  return mac ? rendered.join('') : rendered.join('+');
}

/** The registered `keys` for a shortcut id, or undefined if none is bound. */
export function shortcutFor(id: string): string | undefined {
  return getShortcuts().find((s) => s.id === id)?.keys;
}
