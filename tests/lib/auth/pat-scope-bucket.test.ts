import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeScopeBucket, resetScopeBucketsForTests } from '@/lib/auth/pat-scope-bucket';

beforeEach(() => {
  resetScopeBucketsForTests();
  vi.useRealTimers();
});

describe('pat-scope-bucket', () => {
  it('allows requests up to perMinute then 429s', () => {
    for (let i = 0; i < 3; i++) {
      const r = consumeScopeBucket('tok1', 'pages.write', { perMinute: 3 });
      expect(r.allowed).toBe(true);
    }
    const r = consumeScopeBucket('tok1', 'pages.write', { perMinute: 3 });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.retryAfterSec).toBeGreaterThan(0);
      expect(r.retryAfterSec).toBeLessThanOrEqual(60);
    }
  });

  it('isolates per-(token, scope)', () => {
    consumeScopeBucket('tok1', 'pages.write', { perMinute: 1 });
    expect(consumeScopeBucket('tok1', 'pages.write', { perMinute: 1 }).allowed).toBe(false);
    expect(consumeScopeBucket('tok2', 'pages.write', { perMinute: 1 }).allowed).toBe(true);
    expect(consumeScopeBucket('tok1', 'pages.read', { perMinute: 1 }).allowed).toBe(true);
  });

  it('resets bucket when window elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T00:00:00Z'));
    expect(consumeScopeBucket('tok1', 'pages.write', { perMinute: 1 }).allowed).toBe(true);
    expect(consumeScopeBucket('tok1', 'pages.write', { perMinute: 1 }).allowed).toBe(false);
    vi.setSystemTime(new Date('2026-05-26T00:01:01Z'));
    expect(consumeScopeBucket('tok1', 'pages.write', { perMinute: 1 }).allowed).toBe(true);
  });

  it('returns allowed=true when no limit configured', () => {
    expect(consumeScopeBucket('tok1', 'pages.write', undefined).allowed).toBe(true);
  });

  it('returns allowed=true when perMinute is 0 or negative', () => {
    expect(consumeScopeBucket('tok1', 'pages.write', { perMinute: 0 }).allowed).toBe(true);
    expect(consumeScopeBucket('tok1', 'pages.write', { perMinute: -1 }).allowed).toBe(true);
  });
});
