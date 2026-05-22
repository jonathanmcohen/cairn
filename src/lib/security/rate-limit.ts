/**
 * In-process token-bucket rate limiter. Single-instance only (documented ceiling
 * in SECURITY.md). Generalized from the v0.5.0 API limiter so login/signup/collab
 * mint share one implementation.
 */

export type RateLimitOptions = {
  /** max requests allowed in the window */
  limit: number;
  /** window length in milliseconds */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** ms until the bucket refills enough for one more request (0 if allowed) */
  retryAfterMs: number;
};

type Bucket = { tokens: number; updatedAt: number };

/** A standalone limiter instance (so different surfaces don't share state). */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly opts: RateLimitOptions) {}

  /** Refill rate = limit tokens per windowMs. */
  check(key: string, now = Date.now()): RateLimitResult {
    const { limit, windowMs } = this.opts;
    const ratePerMs = limit / windowMs;
    const b = this.buckets.get(key) ?? { tokens: limit, updatedAt: now };

    // Refill based on elapsed time, capped at `limit`.
    const elapsed = Math.max(0, now - b.updatedAt);
    b.tokens = Math.min(limit, b.tokens + elapsed * ratePerMs);
    b.updatedAt = now;

    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(key, b);
      return { allowed: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
    }

    this.buckets.set(key, b);
    const deficit = 1 - b.tokens;
    return { allowed: false, remaining: 0, retryAfterMs: Math.ceil(deficit / ratePerMs) };
  }

  /** Test/maintenance helper: drop all state. */
  reset(): void {
    this.buckets.clear();
  }
}

/**
 * Extract a client identifier from request headers, trusting x-forwarded-for
 * ONLY when behind a known proxy (homelab reverse proxy). The LEFTMOST entry is
 * the original client; we take it but fall back to the connection-level value.
 */
export function clientIp(headers: Headers, opts: { trustProxy: boolean }): string {
  if (opts.trustProxy) {
    const xff = headers.get('x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    const real = headers.get('x-real-ip');
    if (real) return real.trim();
  }
  return 'unknown';
}

/**
 * Wrap a key function with a limiter. Returns the result; callers decide the
 * response (429 + Retry-After) so this stays framework-agnostic.
 */
export function withRateLimit(
  limiter: RateLimiter,
  keyFn: (req: Request) => string,
): (req: Request) => RateLimitResult {
  return (req: Request) => limiter.check(keyFn(req));
}

// Shared limiters for the auth surfaces. Conservative homelab defaults.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
export const loginLimiter = new RateLimiter({ limit: 5, windowMs: 60_000 }); // 5/min/ip+email
export const signupLimiter = new RateLimiter({ limit: 3, windowMs: 60_000 });
export const collabTokenLimiter = new RateLimiter({ limit: 30, windowMs: 60_000 });

/** Key a request by client IP + an extra identifier (email/pageId). */
export function ipKey(req: Request, identifier: string): string {
  return `${clientIp(req.headers, { trustProxy: TRUST_PROXY })}:${identifier}`;
}
