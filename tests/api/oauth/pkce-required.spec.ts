/**
 * Plan F (MCP OAuth) — PKCE S256 mandatory.
 * Contract stub. Real assertions land with Plan F.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, it } from 'vitest';

describe('Plan F — PKCE required', () => {
  it.todo('authorize without code_challenge → rejected (invalid_request)');
  it.todo('authorize with code_challenge_method=plain → rejected (only S256 allowed)');
  it.todo('token exchange without code_verifier → rejected');
});
