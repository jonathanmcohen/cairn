/**
 * v0.10.0 E2 — per-user "already saw this version's release notes" marker,
 * persisted in localStorage under `cairn:whats-new-seen` — the same
 * migration-free pattern as `src/components/tour/storage.ts`. The stored value
 * is the running app VERSION string, so every upgrade re-shows the badge
 * exactly once per browser profile (badge shows while stored !== appVersion()).
 *
 * Reads are SSR-safe (return `false` when `localStorage` is undefined). Writes
 * are best-effort — quota/security errors are swallowed since the marker is
 * not load-bearing for app correctness. No wildcard harness escape hatch (cf.
 * TOUR_SEEN_WILDCARD_KEY): the badge is a small non-blocking dot on the
 * sidebar version chip and never overlays UI under test.
 */

export const WHATS_NEW_SEEN_KEY = 'cairn:whats-new-seen';

export function hasSeenWhatsNew(version: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(WHATS_NEW_SEEN_KEY) === version;
  } catch {
    return false;
  }
}

export function markWhatsNewSeen(version: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, version);
  } catch {
    // Quota / SecurityError — swallow; the badge will re-show next session.
  }
}

/** Test-only — clears the marker so the first-run badge shows again. */
export function resetWhatsNewForTests(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(WHATS_NEW_SEEN_KEY);
  } catch {
    // ignore
  }
}
