/**
 * v0.10.0 C2 — app-wide maintenance (read-only) mode for destructive restores.
 *
 * While a restore job runs (src/lib/backups/jobs.ts startRestoreJob), the
 * proxy (src/proxy.ts) answers every mutating /api/* request with a 503
 * `{error:'maintenance', reason:'restore'}` so concurrent writes can't race
 * pg_restore's table drops. GET navigation stays up so admins can watch the
 * restore banner and other users see read-only content instead of an outage.
 *
 * The flag is PER-PROCESS, same caveat as the C1 job registry: honest for the
 * documented single-replica deployment; with multiple app replicas only the
 * replica running the restore goes read-only. C3's durable job history is the
 * multi-replica answer.
 *
 * State lives on `globalThis`, NOT at module scope: Next compiles the proxy
 * and each route handler into separate bundles, so a plain module-level
 * variable could be instantiated once per bundle and the proxy would never
 * see the flag the restore route set. One Node process ⇒ one `globalThis` ⇒
 * one flag, regardless of how many bundles import this module.
 */

export type MaintenanceState =
  | { active: false }
  | { active: true; reason: 'restore'; since: string };

const globalStore = globalThis as typeof globalThis & {
  __cairnBackupMaintenance?: MaintenanceState;
};

export function getMaintenance(): MaintenanceState {
  return globalStore.__cairnBackupMaintenance ?? { active: false };
}

export function engageMaintenance(): void {
  globalStore.__cairnBackupMaintenance = {
    active: true,
    reason: 'restore',
    since: new Date().toISOString(),
  };
}

export function disengageMaintenance(): void {
  globalStore.__cairnBackupMaintenance = { active: false };
}
