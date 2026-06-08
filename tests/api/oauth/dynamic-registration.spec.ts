/**
 * Plan F (MCP OAuth) — RFC 7591 dynamic client registration.
 * Contract stub. Real assertions land with Plan F.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, it } from 'vitest';

describe('Plan F — dynamic client registration', () => {
  it.todo('POST /api/oauth/register with redirect_uris → 201 issues client_id');
  it.todo('public client (no token_endpoint_auth) registers without client_secret');
  it.todo('confidential client receives a client_secret (stored hashed)');
  it.todo('rejects registration with no redirect_uris');
});
