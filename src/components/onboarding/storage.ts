/**
 * Per-workspace "already onboarded" flag, persisted in localStorage under
 * `cairn:onboarded:<workspaceId>`. localStorage keeps this v0.8 surface
 * migration-free (the migration ledger 0029–0032 is fully allocated by
 * P8/P17/P19/P20). Per-workspace keying matches Cairn's multi-tenant model:
 * switching workspaces re-runs onboarding for the new one independently.
 *
 * Reads are SSR-safe (return `false` when `localStorage` is undefined). Writes
 * are best-effort — a quota-exceeded error is swallowed since onboarding flags
 * are not load-bearing for app correctness.
 */

const PREFIX = 'cairn:onboarded:';

function key(workspaceId: string): string {
  return `${PREFIX}${workspaceId}`;
}

export function hasOnboarded(workspaceId: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(key(workspaceId)) === '1';
  } catch {
    return false;
  }
}

export function markOnboarded(workspaceId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key(workspaceId), '1');
  } catch {
    // Quota / SecurityError — swallow; the wizard will re-prompt next session.
  }
}

/** Test-only — clears every onboarding flag from localStorage. */
export function resetOnboardingForTests(): void {
  if (typeof localStorage === 'undefined') return;
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) stale.push(k);
  }
  for (const k of stale) localStorage.removeItem(k);
}
