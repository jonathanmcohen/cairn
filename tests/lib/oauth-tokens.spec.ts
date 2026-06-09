/**
 * Plan F (MCP OAuth) — token minting + hashing (mirrors PAT sha256 helpers).
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, expect, it } from 'vitest';
import { hashOauthToken, mintOauthSecret, verifyOauthToken } from '@/lib/oauth/tokens';

describe('mintOauthSecret', () => {
  it('returns a string carrying the requested prefix', () => {
    const t = mintOauthSecret('cairn_oauth_');
    expect(t.startsWith('cairn_oauth_')).toBe(true);
    expect(t.length).toBeGreaterThan('cairn_oauth_'.length + 20);
  });

  it('mints distinct values each call', () => {
    expect(mintOauthSecret('cairn_oart_')).not.toBe(mintOauthSecret('cairn_oart_'));
  });

  it('does NOT collide with the PAT prefix', () => {
    expect(mintOauthSecret('cairn_oauth_').startsWith('cairn_pat_')).toBe(false);
  });
});

describe('hashOauthToken / verifyOauthToken', () => {
  it('hashOauthToken is a deterministic sha256-hex (64 chars)', () => {
    const token = mintOauthSecret('cairn_oauth_');
    const h1 = hashOauthToken(token);
    const h2 = hashOauthToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifyOauthToken is constant-time true for a match, false otherwise', () => {
    const token = mintOauthSecret('cairn_oauth_');
    const hash = hashOauthToken(token);
    expect(verifyOauthToken(token, hash)).toBe(true);
    expect(verifyOauthToken('cairn_oauth_wrong', hash)).toBe(false);
  });
});
