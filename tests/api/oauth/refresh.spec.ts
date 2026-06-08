/**
 * Plan F (MCP OAuth) — refresh-token grant + rotation.
 * Contract stub. Real assertions land with Plan F.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, it } from 'vitest';

describe('Plan F — refresh token', () => {
  it.todo('POST /api/oauth/token (grant_type=refresh_token) → new access_token');
  it.todo('refresh rotates the refresh_token (old one invalidated)');
  it.todo('a revoked refresh_token is rejected');
  it.todo('refresh cannot widen scopes beyond the original grant');
});
