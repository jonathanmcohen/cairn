/**
 * Plan F (MCP OAuth) — authorize endpoint + consent.
 * Contract stub. Real assertions land with Plan F.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, it } from 'vitest';

describe('Plan F — authorize + consent', () => {
  it.todo('unauthenticated GET /api/oauth/authorize → redirect to /login with return URL');
  it.todo('authenticated GET renders the consent screen (client name + requested scopes + workspace)');
  it.todo('Allow issues a single-use authorization code bound to user+workspace+scopes+redirect_uri');
  it.todo('Cancel returns access_denied to the client redirect_uri');
  it.todo('rejects an unknown client_id or mismatched redirect_uri');
});
