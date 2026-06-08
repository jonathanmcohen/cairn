/**
 * Plan F (MCP OAuth) — code → token exchange with PKCE.
 * Contract stub. Real assertions land with Plan F.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, it } from 'vitest';

describe('Plan F — token exchange', () => {
  it.todo('POST /api/oauth/token (grant_type=authorization_code) with valid code_verifier → access_token + refresh_token');
  it.todo('rejects when code_verifier does not match the stored S256 code_challenge');
  it.todo('rejects a reused (already-consumed) authorization code');
  it.todo('rejects an expired authorization code');
  it.todo('issued access_token is hashed at rest and scoped to the granted workspace + scopes');
});
