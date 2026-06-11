/**
 * Per-workspace "already saw the onboarding tour" marker, persisted in
 * localStorage under `cairn:tour-seen:<workspaceId>` — the same migration-free
 * pattern as `src/components/onboarding/storage.ts`. The stored value is the
 * TOUR_VERSION string, so bumping the version re-shows the tour once after an
 * upgrade that meaningfully changes the steps.
 *
 * Reads are SSR-safe (return `false` when `localStorage` is undefined). Writes
 * are best-effort — quota/security errors are swallowed since the tour marker
 * is not load-bearing for app correctness.
 */

const PREFIX = 'cairn:tour-seen:';

/** Bump to re-show the tour once after a step overhaul. */
export const TOUR_VERSION = '1';

/**
 * Harness escape hatch: a wildcard key that marks the tour seen for EVERY
 * workspace. The Playwright fixtures pre-seed it via addInitScript so the
 * dozens of existing specs (fresh contexts = empty localStorage = first-run)
 * don't get the auto-started tour popover overlaying the UI under test.
 * `markTourSeen` never writes it; only test harnesses do.
 */
export const TOUR_SEEN_WILDCARD_KEY = `${PREFIX}*`;

export function tourSeenKey(workspaceId: string): string {
  return `${PREFIX}${workspaceId}`;
}

export function hasSeenTour(workspaceId: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return (
      localStorage.getItem(tourSeenKey(workspaceId)) === TOUR_VERSION ||
      localStorage.getItem(TOUR_SEEN_WILDCARD_KEY) === TOUR_VERSION
    );
  } catch {
    return false;
  }
}

export function markTourSeen(workspaceId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(tourSeenKey(workspaceId), TOUR_VERSION);
  } catch {
    // Quota / SecurityError — swallow; the tour will re-offer next session.
  }
}

/** Test-only — clears every tour marker (including the wildcard). */
export function resetTourForTests(): void {
  if (typeof localStorage === 'undefined') return;
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) stale.push(k);
  }
  for (const k of stale) localStorage.removeItem(k);
}
