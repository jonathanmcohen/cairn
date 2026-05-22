import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collabTokenLimiter, loginLimiter, signupLimiter } from '@/lib/security/rate-limit';

beforeEach(() => {
  loginLimiter.reset();
  signupLimiter.reset();
  collabTokenLimiter.reset();
});
afterEach(() => {
  loginLimiter.reset();
});

describe('login rate limit (5/min/ip+email)', () => {
  it('the 6th bad attempt from the same ip+email trips', async () => {
    const key = '203.0.113.99:victim@x.com';
    for (let i = 0; i < 5; i++) {
      expect(loginLimiter.check(key).allowed).toBe(true);
    }
    expect(loginLimiter.check(key).allowed).toBe(false);
  });

  it('a different email from the same ip is independent', () => {
    for (let i = 0; i < 5; i++) loginLimiter.check('203.0.113.99:a@x.com');
    expect(loginLimiter.check('203.0.113.99:b@x.com').allowed).toBe(true);
  });
});
