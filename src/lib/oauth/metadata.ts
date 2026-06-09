import { OAUTH_SCOPES } from './scopes';

/**
 * v0.9.16 Plan F — discovery metadata builders.
 *
 * `buildAsMetadata` is the RFC 8414 authorization-server metadata the MCP client
 * fetches after the `401 WWW-Authenticate` → resource-metadata hop.
 * `buildResourceMetadata` is the RFC 9728 protected-resource document that names
 * `/api/mcp` as the resource and Cairn as its authorization server.
 *
 * Both are pure functions of the public `origin` (forwarded-host aware via
 * `publicOrigin()` at the call site), so a reverse-proxied deploy advertises the
 * host the user actually reached.
 */
export function buildAsMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    // Public PKCE clients (`none`) + confidential clients posting their secret in
    // the body (`client_secret_post`).
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  };
}

export function buildResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
  };
}
