/**
 * Pure date helpers for PAT quota windows. UTC-pinned so the window boundary
 * is deterministic regardless of process TZ (single-node homelab, but tests
 * run with whatever TZ the container inherits).
 *
 * v0.9.0 G1 P9 — used by `checkQuota` to map an arbitrary timestamp to the
 * canonical day/month window keys persisted in `pat_quota_usage`.
 */

export function dayWindowStart(ts: Date): Date {
  return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate(), 0, 0, 0, 0));
}

export function monthWindowStart(ts: Date): Date {
  return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function nextDayBoundarySec(ts: Date): number {
  const next = new Date(dayWindowStart(ts).getTime() + 24 * 60 * 60 * 1000);
  return Math.max(1, Math.ceil((next.getTime() - ts.getTime()) / 1000));
}

export function nextMonthBoundarySec(ts: Date): number {
  const cur = monthWindowStart(ts);
  const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return Math.max(1, Math.ceil((next.getTime() - ts.getTime()) / 1000));
}
