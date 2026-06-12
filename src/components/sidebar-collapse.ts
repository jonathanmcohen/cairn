/**
 * v0.10.2 S1 — sidebar collapse toggle (Mod+\).
 *
 * Collapse is a root class (`cairn-sidebar-collapsed` on <html>) styled in
 * globals.css down to a 56px icon rail, persisted to localStorage as '1'/'0'
 * under `cairn:sidebar-collapsed`. It is deliberately INDEPENDENT of both:
 *
 * - the resize width: collapsing never touches `--cairn-sidebar-w` or the
 *   persisted `cairn:sidebar-width` value, so un-collapsing restores the
 *   user's prior custom width (the CSS rule overrides the inline width with
 *   `!important` while the class is present);
 * - focus mode: `cairn-focus-mode` hides the aside entirely via
 *   `display: none !important` which wins over any width, and toggling focus
 *   mode never adds/removes this class, so the two cannot desync.
 *
 * Module-level functions (not a hook) so the shortcut registry can call the
 * toggle directly (same pattern as quick-capture's `openQuickCapture`). All
 * entry points are SSR-safe via `typeof document` guards.
 */

export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'cairn:sidebar-collapsed';
export const SIDEBAR_COLLAPSED_CLASS = 'cairn-sidebar-collapsed';

export function isSidebarCollapsed(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains(SIDEBAR_COLLAPSED_CLASS);
}

function applyCollapsed(collapsed: boolean): void {
  document.documentElement.classList.toggle(SIDEBAR_COLLAPSED_CLASS, collapsed);
}

export function toggleSidebarCollapsed(): void {
  if (typeof document === 'undefined') return;
  const next = !isSidebarCollapsed();
  applyCollapsed(next);
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // localStorage may be unavailable (private mode) — the class still applies
    // for the session.
  }
}

/**
 * Re-applies the persisted collapse state on hydration (mirrors how
 * SidebarResizeHandle re-applies `--cairn-sidebar-w` in its mount effect).
 * A brief pre-hydration flash of the expanded sidebar is acceptable;
 * post-hydration correctness is the contract.
 */
export function applySidebarCollapsedOnMount(): void {
  if (typeof document === 'undefined') return;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
  } catch {
    stored = null;
  }
  applyCollapsed(stored === '1');
}
