/**
 * v0.9.0 G8 P39 — SIEM delivery retry backoff schedule.
 *
 * Four attempts at fixed intervals: 1s → 5s → 30s → 5m. After the fourth
 * failure the delivery is marked `failed`; the dispatcher emits a meta-audit
 * `siem.delivery_failed` event (which is itself excluded from re-dispatch so a
 * dead forwarder cannot create an infinite loop).
 */

const SCHEDULE_MS = [1_000, 5_000, 30_000, 5 * 60_000] as const;

export const MAX_ATTEMPTS = SCHEDULE_MS.length;

export function nextBackoffMs(attempt: number): number {
  if (attempt < 1) return SCHEDULE_MS[0];
  if (attempt > SCHEDULE_MS.length) return SCHEDULE_MS[SCHEDULE_MS.length - 1];
  return SCHEDULE_MS[attempt - 1];
}

/**
 * The dispatcher passes the *next* attempt count here (i.e. attempt+1 after
 * the current failure). `MAX_ATTEMPTS + 1` means "we've now exhausted the
 * schedule" — promote the delivery to `failed`.
 */
export function isExhausted(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS + 1;
}
