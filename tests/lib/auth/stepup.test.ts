/**
 * v0.9.0 G1 P8 — step-up TTL helper.
 *
 * Pure-function checks; no DB or env needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireStepUp, STEPUP_TTL_MS } from '@/lib/auth/stepup';

describe('requireStepUp', () => {
  // Freeze the clock so the exact-boundary case is deterministic: requireStepUp
  // calls Date.now() internally, and without a frozen clock the few ms elapsed
  // between the test's Date.now() and the helper's push `now - stepUpAt` just
  // past STEPUP_TTL_MS, flaking the boundary assertion.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes when stepUpAt is within TTL', () => {
    const ok = requireStepUp({ stepUpAt: Date.now() - 60_000 });
    expect(ok).toEqual({ ok: true });
  });

  it('passes at the exact TTL boundary', () => {
    const ok = requireStepUp({ stepUpAt: Date.now() - STEPUP_TTL_MS });
    expect(ok).toEqual({ ok: true });
  });

  it('fails when stepUpAt is older than TTL', () => {
    const ok = requireStepUp({ stepUpAt: Date.now() - (STEPUP_TTL_MS + 10_000) });
    expect(ok).toMatchObject({ ok: false, status: 403, code: 'stepup-required' });
  });

  it('fails when stepUpAt is missing', () => {
    const ok = requireStepUp({ stepUpAt: undefined });
    expect(ok).toMatchObject({ ok: false, status: 403, code: 'stepup-required' });
  });

  it('fails when stepUpAt is null', () => {
    const ok = requireStepUp({ stepUpAt: null });
    expect(ok).toMatchObject({ ok: false, status: 403, code: 'stepup-required' });
  });

  it('fails when stepUpAt is 0', () => {
    const ok = requireStepUp({ stepUpAt: 0 });
    expect(ok).toMatchObject({ ok: false, status: 403, code: 'stepup-required' });
  });
});
