/**
 * Plan F (MCP OAuth) — PKCE S256 verification.
 * RFC 7636 Appendix-B test vector.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, expect, it } from 'vitest';
import { verifyPkceS256 } from '@/lib/oauth/pkce';

// RFC 7636 Appendix B.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('verifyPkceS256', () => {
  it('returns true for the RFC 7636 Appendix-B vector', () => {
    expect(verifyPkceS256(VERIFIER, CHALLENGE)).toBe(true);
  });

  it('returns false for a wrong verifier', () => {
    expect(verifyPkceS256('not-the-verifier', CHALLENGE)).toBe(false);
  });

  it('returns false for a mismatched challenge', () => {
    expect(verifyPkceS256(VERIFIER, 'totally-wrong-challenge')).toBe(false);
  });

  it('returns false for an empty verifier or challenge', () => {
    expect(verifyPkceS256('', CHALLENGE)).toBe(false);
    expect(verifyPkceS256(VERIFIER, '')).toBe(false);
  });
});
