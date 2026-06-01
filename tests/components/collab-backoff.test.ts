import { describe, expect, it, vi } from 'vitest';
import {
  type BackoffConfig,
  computeBackoffDelay,
  DEFAULT_COLLAB_BACKOFF,
  scheduleWithBackoff,
} from '@/components/editor/collab-backoff';

// jitter() is injected so the math is deterministic. rand=0 => no jitter
// added; rand=1 => full jitter band added.
const CFG: BackoffConfig = { baseMs: 1000, maxMs: 30_000, factor: 2, jitterRatio: 0.5 };

describe('computeBackoffDelay', () => {
  it('grows exponentially from the base with no jitter (rand=0)', () => {
    expect(computeBackoffDelay(0, CFG, () => 0)).toBe(1000);
    expect(computeBackoffDelay(1, CFG, () => 0)).toBe(2000);
    expect(computeBackoffDelay(2, CFG, () => 0)).toBe(4000);
    expect(computeBackoffDelay(3, CFG, () => 0)).toBe(8000);
  });

  it('caps the exponential term at maxMs before jitter', () => {
    // attempt 10 => 1000 * 2^10 = 1_024_000, capped to 30_000.
    expect(computeBackoffDelay(10, CFG, () => 0)).toBe(30_000);
  });

  it('adds up to jitterRatio of the capped delay when rand=1', () => {
    // attempt 0: capped=1000, jitter band = 1000 * 0.5 = 500, full => 1500.
    expect(computeBackoffDelay(0, CFG, () => 1)).toBe(1500);
    // attempt 2: capped=4000, jitter band = 2000, full => 6000.
    expect(computeBackoffDelay(2, CFG, () => 1)).toBe(6000);
  });

  it('rounds to an integer millisecond', () => {
    // rand=0.333 => 1000 + (1000*0.5*0.333)=166.5 => rounds to 1167.
    expect(computeBackoffDelay(0, CFG, () => 0.333)).toBe(1167);
  });

  it('clamps negative attempt numbers to attempt 0', () => {
    expect(computeBackoffDelay(-5, CFG, () => 0)).toBe(1000);
  });

  it('exposes sane production defaults', () => {
    expect(DEFAULT_COLLAB_BACKOFF.baseMs).toBe(1000);
    expect(DEFAULT_COLLAB_BACKOFF.maxMs).toBe(30_000);
    expect(DEFAULT_COLLAB_BACKOFF.factor).toBe(2);
    expect(DEFAULT_COLLAB_BACKOFF.jitterRatio).toBeGreaterThan(0);
  });
});

describe('scheduleWithBackoff', () => {
  it('invokes the callback after the computed delay (fake timers)', () => {
    vi.useFakeTimers();
    try {
      const cb = vi.fn();
      // attempt 1, rand=0 => 2000ms with CFG.
      const cancel = scheduleWithBackoff(1, CFG, cb, () => 0);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1999);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(cb).toHaveBeenCalledTimes(1);
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() prevents the callback from firing', () => {
    vi.useFakeTimers();
    try {
      const cb = vi.fn();
      const cancel = scheduleWithBackoff(0, CFG, cb, () => 0);
      cancel();
      vi.advanceTimersByTime(10_000);
      expect(cb).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
