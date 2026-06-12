/**
 * v0.10.0 H3 — sidebar density tokens in a dependency-free module so the
 * runtime-px e2e guard (tests/e2e/item-H3-sidebar-density-px.spec.ts) can
 * import the CONTRACT directly: the component module pulls next/link and
 * cannot be loaded in the Playwright node context. A deliberate density
 * change edits these constants; the component, the unit guard and the
 * pixel-measurement e2e all follow.
 *
 * v0.10.2 S2 — density became a per-device preference (Settings → Account →
 * Theme). Two densities:
 *   - comfortable (default): 26px rows / 13px text / 18px leading — the
 *     pre-S2 values, unchanged.
 *   - compact: 22px rows / 12px text / 16px leading.
 * Row height is consumed by the virtualizer; the font/leading swap lives in
 * globals.css under `html.cairn-sidebar-compact` (overriding the
 * --cairn-sidebar-text/--cairn-sidebar-leading defaults emitted by @theme).
 * Persistence is localStorage-only (mirrors the S1 sidebar-width precedent):
 * NO DB column, NO ThemePrefsSchema change, NO API change.
 */
export type SidebarDensity = 'comfortable' | 'compact';

export const ROW_HEIGHT_BY_DENSITY: Record<SidebarDensity, number> = {
  comfortable: 26, // Compact dense row (#208) — the pre-S2 baseline.
  compact: 22,
};

/** Comfortable (default) baseline — kept exported so pre-S2 imports stay valid. */
export const ROW_HEIGHT_PX = ROW_HEIGHT_BY_DENSITY.comfortable;
export const DEPTH_INDENT_PX = 16; // 16px per level; matches the v0.7 visual.

/** localStorage key holding 'comfortable' | 'compact' (per-device). */
export const SIDEBAR_DENSITY_STORAGE_KEY = 'cairn:sidebar-density';
/** Root (<html>) class that flips the CSS font/leading tokens to compact. */
export const SIDEBAR_DENSITY_COMPACT_CLASS = 'cairn-sidebar-compact';
/** CustomEvent name dispatched on `window` whenever the density changes. */
export const SIDEBAR_DENSITY_EVENT = 'cairn:density-changed';

/**
 * Read the persisted density. SSR-safe: returns 'comfortable' when
 * localStorage is unavailable (server render, private mode) or the stored
 * value is anything other than the literal 'compact'.
 */
export function getSidebarDensity(): SidebarDensity {
  if (typeof localStorage === 'undefined') return 'comfortable';
  try {
    return localStorage.getItem(SIDEBAR_DENSITY_STORAGE_KEY) === 'compact'
      ? 'compact'
      : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

/**
 * Persist the density and notify listeners (the virtualized page tree
 * subscribes to {@link SIDEBAR_DENSITY_EVENT} and re-measures its rows).
 * Persistence failure (private mode) is non-fatal — the event still fires so
 * the change applies for the session.
 */
export function setSidebarDensity(density: SidebarDensity): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SIDEBAR_DENSITY_STORAGE_KEY, density);
    }
  } catch {
    // localStorage may be unavailable — density still applies for the session.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<SidebarDensity>(SIDEBAR_DENSITY_EVENT, { detail: density }),
    );
  }
}

/**
 * Toggle the root class that swaps the sidebar font/leading CSS tokens.
 * SSR-safe no-op without a document. The virtualizer row height is driven
 * separately (React state in virtualized-page-tree.tsx via the change event)
 * because TanStack virtual must `measure()` when the estimate changes.
 */
export function applySidebarDensity(density: SidebarDensity): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle(SIDEBAR_DENSITY_COMPACT_CLASS, density === 'compact');
}
