import { RateLimiter } from '@/lib/security/rate-limit';

/**
 * v0.10.0 G2 — per-peer inbound rate limit for the federated-search route
 * (src/app/api/search/federated/peer/route.ts).
 *
 * Each inbound peer request costs an O(N)-HMAC sweep over the peer list plus
 * a full FTS query, so a compromised/hostile peer could flood the surface.
 * The route verifies the HMAC envelope FIRST, then rate-limits the MATCHED
 * peer by `peer_instances.id` — keying by peer row, NOT by IP, because peers
 * behind a shared egress (NAT, reverse proxy) would otherwise throttle each
 * other. Verify-before-limit means unauthenticated garbage can never burn a
 * legitimate peer's budget (same ordering rationale as the replay-after-
 * signature check in peer-hmac.ts); the cheap HMAC sweep on junk requests is
 * the accepted cost of protecting the expensive FTS work.
 *
 * Ceiling: `CAIRN_PEER_RATE_LIMIT_PER_MIN` requests per 60s window
 * (default 60). Unset / unparseable / non-positive values fall back to the
 * default — never to "unlimited".
 *
 * Failure posture: FAIL CLOSED. If the limiter itself throws,
 * `checkPeerRateLimit` returns `{ allowed: false, unavailable: true }` and
 * the route answers 503 — federation must not become an open relay when the
 * limiter breaks (unlike the soft-fail login path, this surface fans out to
 * expensive cross-instance work).
 *
 * The limiter instance lives on `globalThis`, NOT at module scope: Next
 * compiles route handlers into separate bundles, and a module-level instance
 * could be instantiated once per bundle (see src/lib/backups/maintenance.ts
 * for the full rationale). One Node process ⇒ one `globalThis` ⇒ one bucket
 * map.
 *
 * Multi-replica honesty: the limiter is in-process per replica (same as the
 * v0.5.1 login limiter). With R app replicas the effective ceiling is up to
 * R × the configured limit. Acceptable for the documented single-replica
 * homelab target; noted in docs/operations.md for multi-replica deployments.
 */

/** Operator env var: max inbound requests per peer per minute. */
export const PEER_RATE_LIMIT_ENV_VAR = 'CAIRN_PEER_RATE_LIMIT_PER_MIN';

/** Default ceiling when the env var is unset or unparseable. */
export const PEER_RATE_LIMIT_DEFAULT = 60;

const WINDOW_MS = 60_000;

/** The slice of RateLimiter the helper needs — kept narrow so tests can stub it. */
type PeerLimiterLike = Pick<RateLimiter, 'check'>;

const globalStore = globalThis as typeof globalThis & {
  __cairnPeerRateLimiter?: { limiter: RateLimiter; limit: number };
  __cairnPeerRateLimiterOverride?: PeerLimiterLike;
};

/**
 * Parse the configured per-minute ceiling. Read from process.env directly
 * (NOT the cached env()) — the house pattern for optional knobs, and what
 * lets tests toggle the value per-case.
 */
export function peerRateLimitCeiling(): number {
  const raw = process.env[PEER_RATE_LIMIT_ENV_VAR];
  if (!raw) return PEER_RATE_LIMIT_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return PEER_RATE_LIMIT_DEFAULT;
  return parsed;
}

function limiter(): PeerLimiterLike {
  const override = globalStore.__cairnPeerRateLimiterOverride;
  if (override) return override;
  const limit = peerRateLimitCeiling();
  const existing = globalStore.__cairnPeerRateLimiter;
  // Rebuild only when the configured ceiling changed. In production env vars
  // are fixed at boot so this never re-fires; in tests it yields a fresh
  // limiter (empty buckets) when the knob is toggled.
  if (existing && existing.limit === limit) return existing.limiter;
  const fresh = { limiter: new RateLimiter({ limit, windowMs: WINDOW_MS }), limit };
  globalStore.__cairnPeerRateLimiter = fresh;
  return fresh.limiter;
}

export type PeerRateLimitResult = {
  allowed: boolean;
  /** ms until the bucket refills enough for one more request (0 if allowed). */
  retryAfterMs: number;
  /** True when the limiter itself threw — FAIL CLOSED, the route maps this to 503. */
  unavailable: boolean;
};

/**
 * Check (and consume from) the matched peer's token bucket. `now` is passed
 * through to RateLimiter.check for deterministic tests.
 */
export function checkPeerRateLimit(peerId: string, now?: number): PeerRateLimitResult {
  try {
    const res = limiter().check(peerId, now);
    return { allowed: res.allowed, retryAfterMs: res.retryAfterMs, unavailable: false };
  } catch {
    // FAIL CLOSED — see the file header. Never let a broken limiter wave
    // requests through.
    return { allowed: false, retryAfterMs: 0, unavailable: true };
  }
}

/** Test-only: inject a stub limiter (e.g. one whose check() throws). Pass null to clear. */
export function __setPeerRateLimiterForTests(stub: PeerLimiterLike | null): void {
  globalStore.__cairnPeerRateLimiterOverride = stub ?? undefined;
}

/** Test-only: drop all limiter state (buckets + override). */
export function __resetPeerRateLimiterForTests(): void {
  globalStore.__cairnPeerRateLimiter = undefined;
  globalStore.__cairnPeerRateLimiterOverride = undefined;
}
