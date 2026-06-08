/**
 * Plan F (MCP OAuth) — OAuth tokens enforce PAT scopes at the API layer.
 * Contract stub. Real assertions land with Plan F.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, it } from 'vitest';

describe('Plan F — scope enforcement', () => {
  it.todo('OAuth access_token resolves through the same resolveToken path as PATs (kind=oauth)');
  it.todo('a token granted mcp:read cannot call write MCP tools');
  it.todo('admin tools require the admin scope on the token');
  it.todo('granted scopes are a subset of what the consenting user could grant');
});
