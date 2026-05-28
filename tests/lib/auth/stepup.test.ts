/**
 * v0.9.0 G1 P8 — step-up TTL helper.
 *
 * Pure-function checks; no DB or env needed.
 */
import { describe, expect, it } from 'vitest';
import { requireStepUp, STEPUP_TTL_MS } from '@/lib/auth/stepup';

describe('requireStepUp', () => {
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
