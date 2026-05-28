import { describe, expect, it } from 'vitest';
import { isExhausted, MAX_ATTEMPTS, nextBackoffMs } from '@/lib/siem/backoff';

describe('siem backoff', () => {
  it('returns 1s, 5s, 30s, 5m for attempts 1-4', () => {
    expect(nextBackoffMs(1)).toBe(1_000);
    expect(nextBackoffMs(2)).toBe(5_000);
    expect(nextBackoffMs(3)).toBe(30_000);
    expect(nextBackoffMs(4)).toBe(5 * 60_000);
  });
  it('clamps below 1 to the first slot', () => {
    expect(nextBackoffMs(0)).toBe(1_000);
    expect(nextBackoffMs(-3)).toBe(1_000);
  });
  it('clamps above MAX to the last slot', () => {
    expect(nextBackoffMs(MAX_ATTEMPTS + 1)).toBe(5 * 60_000);
    expect(nextBackoffMs(99)).toBe(5 * 60_000);
  });
  it('isExhausted exactly at MAX_ATTEMPTS + 1', () => {
    expect(isExhausted(MAX_ATTEMPTS)).toBe(false);
    expect(isExhausted(MAX_ATTEMPTS + 1)).toBe(true);
    expect(isExhausted(MAX_ATTEMPTS + 5)).toBe(true);
  });
});
