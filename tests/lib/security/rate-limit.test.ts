import { describe, expect, it } from 'vitest';
import { clientIp, RateLimiter } from '@/lib/security/rate-limit';

describe('RateLimiter token bucket', () => {
  it('allows up to `limit` then trips', () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
    const t = 1_000_000;
    expect(rl.check('k', t).allowed).toBe(true);
    expect(rl.check('k', t).allowed).toBe(true);
    expect(rl.check('k', t).allowed).toBe(true);
    const blocked = rl.check('k', t);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills over time', () => {
    const rl = new RateLimiter({ limit: 2, windowMs: 60_000 });
    const t = 1_000_000;
    rl.check('k', t);
    rl.check('k', t);
    expect(rl.check('k', t).allowed).toBe(false);
    // 60s later → full refill
    expect(rl.check('k', t + 60_000).allowed).toBe(true);
  });

  it('isolates keys', () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 60_000 });
    const t = 1_000_000;
    expect(rl.check('a', t).allowed).toBe(true);
    expect(rl.check('a', t).allowed).toBe(false);
    expect(rl.check('b', t).allowed).toBe(true); // independent
  });

  it('reset clears state', () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 60_000 });
    rl.check('k');
    expect(rl.check('k').allowed).toBe(false);
    rl.reset();
    expect(rl.check('k').allowed).toBe(true);
  });
});

describe('clientIp', () => {
  it('takes leftmost x-forwarded-for when trusting proxy', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    expect(clientIp(h, { trustProxy: true })).toBe('203.0.113.7');
  });
  it('ignores x-forwarded-for when NOT trusting proxy', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7' });
    expect(clientIp(h, { trustProxy: false })).toBe('unknown');
  });
  it('falls back to x-real-ip', () => {
    const h = new Headers({ 'x-real-ip': '198.51.100.5' });
    expect(clientIp(h, { trustProxy: true })).toBe('198.51.100.5');
  });
});
