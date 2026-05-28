/**
 * v0.9.0 G1 P8 — step-up middleware.
 *
 * Sensitive operations (workspace delete, admin role grant, future destructive
 * surfaces) require a fresh WebAuthn assertion. The Auth.js JWT carries a
 * `stepUpAt` epoch-ms timestamp set by /api/webauthn/assert; callers consult
 * this helper to decide whether the assertion is recent enough.
 *
 * 5-minute TTL chosen to balance friction vs. blast-radius: a stolen session
 * that happens to be inside the window can still perform one destructive op,
 * but not arbitrary ones over a longer compromise. Tune per deployment if
 * the deployment threat model demands shorter.
 */

export const STEPUP_TTL_MS = 5 * 60 * 1000;

export type StepUpResult =
  | { ok: true }
  | { ok: false; status: 403; code: 'stepup-required'; message: string };

export function requireStepUp(input: { stepUpAt: number | undefined | null }): StepUpResult {
  if (!input.stepUpAt) {
    return {
      ok: false,
      status: 403,
      code: 'stepup-required',
      message: 'WebAuthn step-up required',
    };
  }
  if (Date.now() - input.stepUpAt > STEPUP_TTL_MS) {
    return {
      ok: false,
      status: 403,
      code: 'stepup-required',
      message: 'WebAuthn step-up expired',
    };
  }
  return { ok: true };
}
