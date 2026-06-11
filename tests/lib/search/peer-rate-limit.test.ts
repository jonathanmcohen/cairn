import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetPeerRateLimiterForTests,
  __setPeerRateLimiterForTests,
  checkPeerRateLimit,
  PEER_RATE_LIMIT_DEFAULT,
  PEER_RATE_LIMIT_ENV_VAR,
  peerRateLimitCeiling,
} from '@/lib/search/peer-rate-limit';

// v0.10.0 G2 — per-peer inbound rate limit helper. Pure unit tests (no DB);
// the route-level behavior (429 / Retry-After / audit / 503 fail-closed) is
// pinned in tests/api/search/peer-inbound.test.ts.

beforeEach(() => {
  delete process.env[PEER_RATE_LIMIT_ENV_VAR];
  __resetPeerRateLimiterForTests();
});

afterEach(() => {
  delete process.env[PEER_RATE_LIMIT_ENV_VAR];
  __resetPeerRateLimiterForTests();
});

describe('peerRateLimitCeiling', () => {
  it('defaults to 60/min when the env var is unset', () => {
    expect(peerRateLimitCeiling()).toBe(PEER_RATE_LIMIT_DEFAULT);
    expect(PEER_RATE_LIMIT_DEFAULT).toBe(60);
  });

  it('respects a valid override', () => {
    process.env[PEER_RATE_LIMIT_ENV_VAR] = '7';
    expect(peerRateLimitCeiling()).toBe(7);
  });

  it.each([
    'not-a-number',
    '0',
    '-5',
    '',
  ])('falls back to the default for unusable value %j (never "unlimited")', (value) => {
    process.env[PEER_RATE_LIMIT_ENV_VAR] = value;
    expect(peerRateLimitCeiling()).toBe(PEER_RATE_LIMIT_DEFAULT);
  });
});

describe('checkPeerRateLimit', () => {
  it('allows up to the configured ceiling, then limits with retryAfterMs > 0', () => {
    process.env[PEER_RATE_LIMIT_ENV_VAR] = '3';
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(checkPeerRateLimit('peer-a', now)).toEqual({
        allowed: true,
        retryAfterMs: 0,
        unavailable: false,
      });
    }
    const limited = checkPeerRateLimit('peer-a', now);
    expect(limited.allowed).toBe(false);
    expect(limited.unavailable).toBe(false);
    expect(limited.retryAfterMs).toBeGreaterThan(0);
  });

  it('isolates buckets by peer id — one peer exhausted, the other unaffected', () => {
    process.env[PEER_RATE_LIMIT_ENV_VAR] = '2';
    const now = 1_000_000;
    expect(checkPeerRateLimit('peer-a', now).allowed).toBe(true);
    expect(checkPeerRateLimit('peer-a', now).allowed).toBe(true);
    expect(checkPeerRateLimit('peer-a', now).allowed).toBe(false);
    expect(checkPeerRateLimit('peer-b', now).allowed).toBe(true);
  });

  it('refills the bucket after windowMs (deterministic via the now parameter)', () => {
    process.env[PEER_RATE_LIMIT_ENV_VAR] = '2';
    const t0 = 1_000_000;
    expect(checkPeerRateLimit('peer-a', t0).allowed).toBe(true);
    expect(checkPeerRateLimit('peer-a', t0).allowed).toBe(true);
    expect(checkPeerRateLimit('peer-a', t0).allowed).toBe(false);
    // One full window later the bucket is back at capacity.
    expect(checkPeerRateLimit('peer-a', t0 + 60_000).allowed).toBe(true);
    expect(checkPeerRateLimit('peer-a', t0 + 60_000).allowed).toBe(true);
    expect(checkPeerRateLimit('peer-a', t0 + 60_000).allowed).toBe(false);
  });

  it('changing the env ceiling rebuilds the limiter with the new limit', () => {
    process.env[PEER_RATE_LIMIT_ENV_VAR] = '1';
    const now = 1_000_000;
    expect(checkPeerRateLimit('peer-a', now).allowed).toBe(true);
    expect(checkPeerRateLimit('peer-a', now).allowed).toBe(false);
    // Raising the knob mints a fresh limiter (empty buckets) at the new cap.
    process.env[PEER_RATE_LIMIT_ENV_VAR] = '2';
    expect(checkPeerRateLimit('peer-a', now).allowed).toBe(true);
    expect(checkPeerRateLimit('peer-a', now).allowed).toBe(true);
    expect(checkPeerRateLimit('peer-a', now).allowed).toBe(false);
  });

  it('FAILS CLOSED when the limiter throws: allowed=false + unavailable=true', () => {
    __setPeerRateLimiterForTests({
      check: () => {
        throw new Error('boom');
      },
    });
    expect(checkPeerRateLimit('peer-a')).toEqual({
      allowed: false,
      retryAfterMs: 0,
      unavailable: true,
    });
  });

  it('clearing the stub restores the real limiter', () => {
    __setPeerRateLimiterForTests({
      check: () => {
        throw new Error('boom');
      },
    });
    expect(checkPeerRateLimit('peer-a').unavailable).toBe(true);
    __setPeerRateLimiterForTests(null);
    expect(checkPeerRateLimit('peer-a')).toEqual({
      allowed: true,
      retryAfterMs: 0,
      unavailable: false,
    });
  });
});
