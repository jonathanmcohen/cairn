/**
 * Plan F (MCP OAuth) — Settings → Developer → OAuth connections list.
 * Contract stub. Real assertions land with Plan F.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, it } from 'vitest';

describe('Plan F — OAuth connections list', () => {
  it.todo('Settings → Developer shows each active grant: client name, scopes, last used');
  it.todo('each grant has a Revoke button that calls /api/oauth/revoke');
  it.todo('revoking removes the row (like the Active sessions list)');
});
