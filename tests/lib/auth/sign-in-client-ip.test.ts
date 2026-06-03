import { describe, expect, it } from 'vitest';
import { resolveSignInIp } from '@/lib/auth/sign-in-client';

describe('resolveSignInIp (#192)', () => {
  it('returns the leftmost XFF entry when proxy is trusted', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 172.18.0.1' });
    expect(resolveSignInIp(h, { trustProxy: true })).toBe('203.0.113.9');
  });
  it('returns null (hides Docker bridge IP) when proxy is NOT trusted', () => {
    const h = new Headers({ 'x-forwarded-for': '172.18.0.1' });
    expect(resolveSignInIp(h, { trustProxy: false })).toBeNull();
  });
  it('falls back to x-real-ip when trusted and no XFF', () => {
    const h = new Headers({ 'x-real-ip': '198.51.100.7' });
    expect(resolveSignInIp(h, { trustProxy: true })).toBe('198.51.100.7');
  });
});
