/**
 * Plan F (MCP OAuth) — RFC 7009 revocation.
 * Contract stub. Real assertions land with Plan F.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, it } from 'vitest';

describe('Plan F — token revocation', () => {
  it.todo('POST /api/oauth/revoke kills the access_token (subsequent MCP call 401s)');
  it.todo('revoking a refresh_token also invalidates its access tokens');
  it.todo('records an oauth.token_revoked audit event');
  it.todo('revoke is idempotent / returns 200 for an already-revoked or unknown token (RFC 7009)');
});
