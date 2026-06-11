import { RateLimiter } from '@/lib/security/rate-limit';

/**
 * v0.10.0 G5 — flood control for RFC 7591 dynamic client registration
 * (`POST /api/oauth/register`, src/app/api/oauth/register/route.ts).
 *
 * Registration is unauthenticated BY DESIGN (MCP clients self-register before
 * any user signs in), which makes it a free unbounded-write surface: every
 * accepted request inserts an `oauth_clients` row. D3 shipped detection (the
 * admin registry + purge); this module is prevention. Two token buckets are
 * checked, BOTH before any parsing or DB work:
 *
 *   per-IP   `CAIRN_OAUTH_REGISTER_LIMIT_PER_MIN`        (default 10/min)
 *   global   `CAIRN_OAUTH_REGISTER_GLOBAL_LIMIT_PER_MIN` (default 30/min)
 *
 * The per-IP bucket throttles a single noisy source; the global bucket caps
 * total registration churn even against a distributed flood (or when the
 * instance runs without a trusted proxy, where every caller shares the
 * `unknown` IP key). Either bucket exhausted ⇒ limited; `scope` says which so
 * the route can name the tripped ceiling in `error_description`. Unset /
 * unparseable / non-positive env values fall back to the defaults — never to
 * "unlimited".
 *
 * Bucket ordering: the per-IP bucket is consulted FIRST and a rejection
 * short-circuits WITHOUT touching the global bucket — probing the global
 * bucket on an already-rejected request would consume a global token for work
 * that 429s anyway, letting one throttled IP starve everyone else's shared
 * budget. (Consequence: when both buckets happen to be empty the reported
 * retryAfterMs is the per-IP bucket's, which is advisory anyway.)
 *
 * Failure posture: FAIL CLOSED (mirrors src/lib/search/peer-rate-limit.ts).
 * If the limiter itself throws, `checkRegisterRateLimit` returns
 * `{ allowed: false, unavailable: true }` and the route answers 503 —
 * registration must not become unthrottled when the throttle breaks.
 *
 * Limiter instances live on `globalThis`, NOT at module scope: Next compiles
 * route handlers into separate bundles, and a module-level instance could be
 * instantiated once per bundle (see src/lib/backups/maintenance.ts for the
 * full rationale). One Node process ⇒ one `globalThis` ⇒ one bucket map.
 *
 * Multi-replica honesty: in-process per replica (same as the peer and login
 * limiters) — with R replicas the effective ceilings are up to R × the
 * configured limits. Acceptable for the documented single-replica target.
 */

/** Operator env var: max registrations per client IP per minute. */
export const REGISTER_IP_LIMIT_ENV_VAR = 'CAIRN_OAUTH_REGISTER_LIMIT_PER_MIN';

/** Default per-IP ceiling when the env var is unset or unparseable. */
export const REGISTER_IP_LIMIT_DEFAULT = 10;

/** Operator env var: max registrations instance-wide per minute. */
export const REGISTER_GLOBAL_LIMIT_ENV_VAR = 'CAIRN_OAUTH_REGISTER_GLOBAL_LIMIT_PER_MIN';

/** Default global ceiling when the env var is unset or unparseable. */
export const REGISTER_GLOBAL_LIMIT_DEFAULT = 30;

const WINDOW_MS = 60_000;

/** Single key for the instance-wide bucket. */
const GLOBAL_KEY = '__global__';

/** The slice of RateLimiter the helper needs — kept narrow so tests can stub it. */
type RegisterLimiterLike = Pick<RateLimiter, 'check'>;

const globalStore = globalThis as typeof globalThis & {
  __cairnOauthRegisterIpLimiter?: { limiter: RateLimiter; limit: number };
  __cairnOauthRegisterGlobalLimiter?: { limiter: RateLimiter; limit: number };
  __cairnOauthRegisterLimiterOverride?: RegisterLimiterLike;
};

/**
 * Parse a per-minute ceiling from process.env directly (NOT the cached env())
 * — the house pattern for optional knobs, and what lets tests toggle the
 * value per-case.
 */
function ceiling(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function registerIpLimitCeiling(): number {
  return ceiling(REGISTER_IP_LIMIT_ENV_VAR, REGISTER_IP_LIMIT_DEFAULT);
}

export function registerGlobalLimitCeiling(): number {
  return ceiling(REGISTER_GLOBAL_LIMIT_ENV_VAR, REGISTER_GLOBAL_LIMIT_DEFAULT);
}

function ipLimiter(): RegisterLimiterLike {
  const override = globalStore.__cairnOauthRegisterLimiterOverride;
  if (override) return override;
  const limit = registerIpLimitCeiling();
  const existing = globalStore.__cairnOauthRegisterIpLimiter;
  // Rebuild only when the configured ceiling changed (fixed at boot in prod;
  // in tests a knob toggle yields a fresh limiter with empty buckets).
  if (existing && existing.limit === limit) return existing.limiter;
  const fresh = { limiter: new RateLimiter({ limit, windowMs: WINDOW_MS }), limit };
  globalStore.__cairnOauthRegisterIpLimiter = fresh;
  return fresh.limiter;
}

function globalLimiter(): RegisterLimiterLike {
  const override = globalStore.__cairnOauthRegisterLimiterOverride;
  if (override) return override;
  const limit = registerGlobalLimitCeiling();
  const existing = globalStore.__cairnOauthRegisterGlobalLimiter;
  if (existing && existing.limit === limit) return existing.limiter;
  const fresh = { limiter: new RateLimiter({ limit, windowMs: WINDOW_MS }), limit };
  globalStore.__cairnOauthRegisterGlobalLimiter = fresh;
  return fresh.limiter;
}

export type RegisterRateLimitResult = {
  allowed: boolean;
  /** Which bucket tripped when limited (null when allowed or unavailable). */
  scope: 'ip' | 'global' | null;
  /** ms until the tripped bucket refills enough for one more request (0 if allowed). */
  retryAfterMs: number;
  /** True when the limiter itself threw — FAIL CLOSED, the route maps this to 503. */
  unavailable: boolean;
};

/**
 * Check (and consume from) the per-IP bucket, then the global bucket. `now`
 * is passed through to RateLimiter.check for deterministic tests.
 */
export function checkRegisterRateLimit(ip: string, now?: number): RegisterRateLimitResult {
  try {
    const perIp = ipLimiter().check(`ip:${ip}`, now);
    if (!perIp.allowed) {
      return { allowed: false, scope: 'ip', retryAfterMs: perIp.retryAfterMs, unavailable: false };
    }
    const global = globalLimiter().check(GLOBAL_KEY, now);
    if (!global.allowed) {
      return {
        allowed: false,
        scope: 'global',
        retryAfterMs: global.retryAfterMs,
        unavailable: false,
      };
    }
    return { allowed: true, scope: null, retryAfterMs: 0, unavailable: false };
  } catch {
    // FAIL CLOSED — see the file header. Never let a broken limiter wave
    // unauthenticated writes through.
    return { allowed: false, scope: null, retryAfterMs: 0, unavailable: true };
  }
}

/**
 * Test-only: inject a stub limiter used for BOTH buckets (e.g. one whose
 * check() throws, to pin the fail-closed path). Pass null to clear.
 */
export function __setRegisterRateLimiterForTests(stub: RegisterLimiterLike | null): void {
  globalStore.__cairnOauthRegisterLimiterOverride = stub ?? undefined;
}

/** Test-only: drop all limiter state (both buckets + override). */
export function __resetRegisterRateLimiterForTests(): void {
  globalStore.__cairnOauthRegisterIpLimiter = undefined;
  globalStore.__cairnOauthRegisterGlobalLimiter = undefined;
  globalStore.__cairnOauthRegisterLimiterOverride = undefined;
}
