/**
 * Plan F (MCP OAuth) — RFC 8414 / protected-resource discovery.
 * Contract stub. Real assertions land with Plan F.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, it } from 'vitest';

describe('Plan F — OAuth discovery', () => {
  it.todo('GET /.well-known/oauth-authorization-server → 200 with issuer, authorization_endpoint, token_endpoint, registration_endpoint, revocation_endpoint');
  it.todo('advertises code_challenge_methods_supported includes "S256"');
  it.todo('advertises grant_types_supported includes authorization_code + refresh_token');
  it.todo('GET /.well-known/oauth-protected-resource → 200 pointing at the /api/mcp resource + authorization_servers');
});
