/**
 * Plan F (MCP OAuth) — unauthenticated MCP request advertises OAuth.
 * Contract stub. Real assertions land with Plan F.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, it } from 'vitest';

describe('Plan F — MCP WWW-Authenticate', () => {
  it.todo('unauthenticated request to /api/mcp → 401 with WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"');
  it.todo('the resource_metadata URL resolves to the protected-resource document');
  it.todo('a valid OAuth access_token still reaches MCP tools (backward compat: PAT also works)');
});
