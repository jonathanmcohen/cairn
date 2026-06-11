import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetRegisterRateLimiterForTests,
  __setRegisterRateLimiterForTests,
  checkRegisterRateLimit,
  REGISTER_GLOBAL_LIMIT_DEFAULT,
  REGISTER_GLOBAL_LIMIT_ENV_VAR,
  REGISTER_IP_LIMIT_DEFAULT,
  REGISTER_IP_LIMIT_ENV_VAR,
  registerGlobalLimitCeiling,
  registerIpLimitCeiling,
} from '@/lib/oauth/register-rate-limit';

// v0.10.0 G5 — flood-control helper for POST /api/oauth/register. Pure unit
// tests (no DB); the route-level behavior (429 / Retry-After / 503
// fail-closed / nothing-written) is pinned in
// tests/api/oauth/register-flood-control.spec.ts.

function clearEnv(): void {
  delete process.env[REGISTER_IP_LIMIT_ENV_VAR];
  delete process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR];
}

beforeEach(() => {
  clearEnv();
  __resetRegisterRateLimiterForTests();
});

afterEach(() => {
  clearEnv();
  __resetRegisterRateLimiterForTests();
});

describe('ceilings', () => {
  it('per-IP defaults to 10/min when the env var is unset', () => {
    expect(registerIpLimitCeiling()).toBe(REGISTER_IP_LIMIT_DEFAULT);
    expect(REGISTER_IP_LIMIT_DEFAULT).toBe(10);
  });

  it('global defaults to 30/min when the env var is unset', () => {
    expect(registerGlobalLimitCeiling()).toBe(REGISTER_GLOBAL_LIMIT_DEFAULT);
    expect(REGISTER_GLOBAL_LIMIT_DEFAULT).toBe(30);
  });

  it('respects valid overrides for both knobs', () => {
    process.env[REGISTER_IP_LIMIT_ENV_VAR] = '7';
    process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR] = '99';
    expect(registerIpLimitCeiling()).toBe(7);
    expect(registerGlobalLimitCeiling()).toBe(99);
  });

  it.each([
    'not-a-number',
    '0',
    '-5',
    '',
  ])('falls back to the defaults for unusable value %j (never "unlimited")', (value) => {
    process.env[REGISTER_IP_LIMIT_ENV_VAR] = value;
    process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR] = value;
    expect(registerIpLimitCeiling()).toBe(REGISTER_IP_LIMIT_DEFAULT);
    expect(registerGlobalLimitCeiling()).toBe(REGISTER_GLOBAL_LIMIT_DEFAULT);
  });
});

describe('checkRegisterRateLimit', () => {
  it('allows up to the per-IP ceiling, then limits with scope=ip and retryAfterMs > 0', () => {
    process.env[REGISTER_IP_LIMIT_ENV_VAR] = '3';
    process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR] = '100';
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(checkRegisterRateLimit('1.2.3.4', now)).toEqual({
        allowed: true,
        scope: null,
        retryAfterMs: 0,
        unavailable: false,
      });
    }
    const limited = checkRegisterRateLimit('1.2.3.4', now);
    expect(limited.allowed).toBe(false);
    expect(limited.scope).toBe('ip');
    expect(limited.unavailable).toBe(false);
    expect(limited.retryAfterMs).toBeGreaterThan(0);
  });

  it('isolates buckets by IP — one IP exhausted, the other unaffected', () => {
    process.env[REGISTER_IP_LIMIT_ENV_VAR] = '2';
    process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR] = '100';
    const now = 1_000_000;
    expect(checkRegisterRateLimit('10.0.0.1', now).allowed).toBe(true);
    expect(checkRegisterRateLimit('10.0.0.1', now).allowed).toBe(true);
    expect(checkRegisterRateLimit('10.0.0.1', now).allowed).toBe(false);
    expect(checkRegisterRateLimit('10.0.0.2', now).allowed).toBe(true);
  });

  it('global ceiling trips with scope=global even when every per-IP bucket is fine', () => {
    process.env[REGISTER_IP_LIMIT_ENV_VAR] = '100';
    process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR] = '3';
    const now = 1_000_000;
    // Three distinct IPs, one request each — none is near its per-IP limit.
    expect(checkRegisterRateLimit('10.0.0.1', now).allowed).toBe(true);
    expect(checkRegisterRateLimit('10.0.0.2', now).allowed).toBe(true);
    expect(checkRegisterRateLimit('10.0.0.3', now).allowed).toBe(true);
    const limited = checkRegisterRateLimit('10.0.0.4', now);
    expect(limited.allowed).toBe(false);
    expect(limited.scope).toBe('global');
    expect(limited.retryAfterMs).toBeGreaterThan(0);
  });

  it('an ip-limited request does NOT consume from the global bucket', () => {
    process.env[REGISTER_IP_LIMIT_ENV_VAR] = '1';
    process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR] = '2';
    const now = 1_000_000;
    expect(checkRegisterRateLimit('10.0.0.1', now).allowed).toBe(true); // ip ok, global 1/2
    // Hammering the same throttled IP must not drain the global budget…
    for (let i = 0; i < 5; i++) {
      expect(checkRegisterRateLimit('10.0.0.1', now).scope).toBe('ip');
    }
    // …so a different IP still gets the remaining global token.
    expect(checkRegisterRateLimit('10.0.0.2', now).allowed).toBe(true);
  });

  it('refills both buckets after windowMs (deterministic via the now parameter)', () => {
    process.env[REGISTER_IP_LIMIT_ENV_VAR] = '2';
    process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR] = '2';
    const t0 = 1_000_000;
    expect(checkRegisterRateLimit('10.0.0.1', t0).allowed).toBe(true);
    expect(checkRegisterRateLimit('10.0.0.1', t0).allowed).toBe(true);
    expect(checkRegisterRateLimit('10.0.0.1', t0).allowed).toBe(false);
    // One full window later both buckets are back at capacity.
    expect(checkRegisterRateLimit('10.0.0.1', t0 + 60_000).allowed).toBe(true);
    expect(checkRegisterRateLimit('10.0.0.1', t0 + 60_000).allowed).toBe(true);
    expect(checkRegisterRateLimit('10.0.0.1', t0 + 60_000).allowed).toBe(false);
  });

  it('changing an env ceiling rebuilds that limiter with the new limit', () => {
    process.env[REGISTER_IP_LIMIT_ENV_VAR] = '1';
    process.env[REGISTER_GLOBAL_LIMIT_ENV_VAR] = '100';
    const now = 1_000_000;
    expect(checkRegisterRateLimit('10.0.0.1', now).allowed).toBe(true);
    expect(checkRegisterRateLimit('10.0.0.1', now).allowed).toBe(false);
    // Raising the knob mints a fresh limiter (empty buckets) at the new cap.
    process.env[REGISTER_IP_LIMIT_ENV_VAR] = '2';
    expect(checkRegisterRateLimit('10.0.0.1', now).allowed).toBe(true);
    expect(checkRegisterRateLimit('10.0.0.1', now).allowed).toBe(true);
    expect(checkRegisterRateLimit('10.0.0.1', now).allowed).toBe(false);
  });

  it('FAILS CLOSED when the limiter throws: allowed=false + unavailable=true', () => {
    __setRegisterRateLimiterForTests({
      check: () => {
        throw new Error('boom');
      },
    });
    expect(checkRegisterRateLimit('10.0.0.1')).toEqual({
      allowed: false,
      scope: null,
      retryAfterMs: 0,
      unavailable: true,
    });
  });

  it('clearing the stub restores the real limiter', () => {
    __setRegisterRateLimiterForTests({
      check: () => {
        throw new Error('boom');
      },
    });
    expect(checkRegisterRateLimit('10.0.0.1').unavailable).toBe(true);
    __setRegisterRateLimiterForTests(null);
    expect(checkRegisterRateLimit('10.0.0.1')).toEqual({
      allowed: true,
      scope: null,
      retryAfterMs: 0,
      unavailable: false,
    });
  });
});
