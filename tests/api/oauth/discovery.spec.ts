/**
 * Plan F (MCP OAuth) — RFC 8414 authorization-server metadata + RFC 9728
 * protected-resource metadata. Both are DB-free but publicOrigin()-derived, so
 * we mock next/headers to assert the forwarded host is reflected.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let forwardedHost = 'cairn.example.com';

vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve(
      new Headers({
        'x-forwarded-host': forwardedHost,
        'x-forwarded-proto': 'https',
      }),
    ),
}));

beforeEach(() => {
  // publicOrigin prefers a real NEXTAUTH_URL; keep it the localhost build-default
  // so resolution falls through to the forwarded-host header.
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  delete process.env.PUBLIC_URL;
  forwardedHost = 'cairn.example.com';
});

describe('Plan F — OAuth discovery', () => {
  it('GET /.well-known/oauth-authorization-server → RFC 8414 document', async () => {
    const { GET } = await import('@/app/.well-known/oauth-authorization-server/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.issuer).toBe('https://cairn.example.com');
    expect(body.authorization_endpoint).toBe('https://cairn.example.com/api/oauth/authorize');
    expect(body.token_endpoint).toBe('https://cairn.example.com/api/oauth/token');
    expect(body.registration_endpoint).toBe('https://cairn.example.com/api/oauth/register');
    expect(body.revocation_endpoint).toBe('https://cairn.example.com/api/oauth/revoke');

    expect(body.response_types_supported).toEqual(['code']);
    expect(body.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.token_endpoint_auth_methods_supported).toContain('none');
    // v0.10.0 G4 — revoke now authenticates clients like the token endpoint.
    expect(body.revocation_endpoint_auth_methods_supported).toEqual(['none', 'client_secret_post']);

    // The 16 PAT scopes are the OAuth scope vocabulary.
    const scopes = body.scopes_supported as string[];
    expect(scopes).toContain('mcp:read');
    expect(scopes).toContain('pages:read');
    expect(scopes).toContain('admin');
    expect(scopes).toHaveLength(16);
  });

  it('advertises a 1h cache-control header', async () => {
    const { GET } = await import('@/app/.well-known/oauth-authorization-server/route');
    const res = await GET();
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
  });

  it('GET /.well-known/oauth-protected-resource points at /api/mcp', async () => {
    const { GET } = await import('@/app/.well-known/oauth-protected-resource/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.resource).toBe('https://cairn.example.com/api/mcp');
    expect(body.authorization_servers).toEqual(['https://cairn.example.com']);
  });

  it('reflects the forwarded host (publicOrigin-derived)', async () => {
    forwardedHost = 'notes.acme.test';
    const { GET } = await import('@/app/.well-known/oauth-authorization-server/route');
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.issuer).toBe('https://notes.acme.test');
  });
});
