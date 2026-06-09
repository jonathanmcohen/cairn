import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * v0.9.16 Plan F — PKCE S256 verification (RFC 7636 §4.6).
 *
 * The client sends a `code_challenge` = base64url(sha256(code_verifier)) at
 * /authorize, then the raw `code_verifier` at /token. We recompute the challenge
 * from the presented verifier and constant-time compare it to the bound one.
 *
 * S256 is the ONLY supported method (the `plain` method is rejected upstream at
 * /authorize, and this helper only ever computes the S256 transform).
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  const computed = createHash('sha256').update(codeVerifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
