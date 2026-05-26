/**
 * In-process per-(tokenId, scopeId) per-minute bucket. Single-node homelab
 * acceptable: bucket lives in module-level Map; restarts reset all buckets,
 * which is OK because the DB rollup (`pat_quota_usage`) covers the per-day /
 * per-month caps. Multi-process deployments would need a shared store like
 * Redis — out of scope for v0.9.0.
 *
 * Window is a fixed 60-second slot pinned to UTC minute starts so the
 * boundary is deterministic in tests + identical across processes (if a
 * future multi-process build switches to Redis it can reuse this key shape).
 *
 * v0.9.0 G1 P9.
 */

export type ScopeLimit = { perMinute: number } | undefined;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function keyFor(tokenId: string, scopeId: string): string {
  return `${tokenId}::${scopeId}`;
}

function minuteStartMs(now: number): number {
  return now - (now % 60_000);
}

export type ConsumeResult = { allowed: true } | { allowed: false; retryAfterSec: number };

/**
 * Tick the bucket for `(tokenId, scopeId)`. When the limit is undefined or
 * non-positive, returns `{allowed: true}` without touching the bucket — this
 * lets callers pass through "no limit configured" tokens with no overhead.
 *
 * On a hit ≥ `perMinute`, returns `{allowed: false, retryAfterSec}` with the
 * remaining seconds until the bucket boundary. NEVER includes the limit in
 * the result — caller emits a generic 429 + Retry-After so other tokens'
 * configs are not leaked through error responses.
 */
export function consumeScopeBucket(
  tokenId: string,
  scopeId: string,
  limit: ScopeLimit,
): ConsumeResult {
  if (!limit || limit.perMinute <= 0) return { allowed: true };
  const now = Date.now();
  const windowStart = minuteStartMs(now);
  const key = keyFor(tokenId, scopeId);
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: windowStart + 60_000 };
    buckets.set(key, b);
  }
  if (b.count >= limit.perMinute) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count += 1;
  return { allowed: true };
}

/** Test-only: clear all buckets. */
export function resetScopeBucketsForTests(): void {
  buckets.clear();
}
