import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { IdpConfiguration } from '@/db/schema/sso';
import { buildAuthRequest, exchangeCode, getOidcMetadata } from '@/lib/sso/oidc';

function makeConfig(meta: Record<string, unknown>): IdpConfiguration {
  return {
    id: 'i1',
    workspaceId: 'w1',
    type: 'oidc',
    name: 'IdP',
    metadata: meta,
    attributeMap: { email: 'email' },
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IdpConfiguration;
}

describe('getOidcMetadata', () => {
  it('fetches the discovery document at <issuer>/.well-known/openid-configuration', async () => {
    const discoveryDoc = {
      issuer: 'https://idp.example.com',
      authorization_endpoint: 'https://idp.example.com/authorize',
      token_endpoint: 'https://idp.example.com/token',
      jwks_uri: 'https://idp.example.com/jwks',
    };
    const fetchImpl = async (url: string | URL) => {
      expect(String(url)).toBe('https://idp.example.com/.well-known/openid-configuration');
      return new Response(JSON.stringify(discoveryDoc), {
        headers: { 'content-type': 'application/json' },
      });
    };
    const meta = await getOidcMetadata(
      makeConfig({ issuer: 'https://idp.example.com', clientId: 'cid', clientSecret: 'csec' }),
      fetchImpl as typeof fetch,
    );
    expect(meta.authorization_endpoint).toBe('https://idp.example.com/authorize');
  });

  it('throws when discovery returns a non-200', async () => {
    const fetchImpl = async () => new Response('not found', { status: 404 });
    await expect(
      getOidcMetadata(
        makeConfig({ issuer: 'https://idp.example.com', clientId: 'cid', clientSecret: 'csec' }),
        fetchImpl as typeof fetch,
      ),
    ).rejects.toThrow(/discovery/i);
  });
});

describe('buildAuthRequest', () => {
  it('builds an authorization URL with required params', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          issuer: 'https://idp.example.com',
          authorization_endpoint: 'https://idp.example.com/authorize',
          token_endpoint: 'https://idp.example.com/token',
          jwks_uri: 'https://idp.example.com/jwks',
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    const url = await buildAuthRequest(
      makeConfig({ issuer: 'https://idp.example.com', clientId: 'cid', clientSecret: 'csec' }),
      { state: 'st', nonce: 'no', redirectUri: 'http://localhost:3000/api/sso/oidc/callback/i1' },
      fetchImpl as typeof fetch,
    );
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://idp.example.com/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.get('nonce')).toBe('no');
    expect(u.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/sso/oidc/callback/i1',
    );
  });
});

describe('exchangeCode', () => {
  it('exchanges code -> id_token and returns the sub + claims', async () => {
    // Generate an ephemeral keypair to sign the test id_token.
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-kid';
    jwk.use = 'sig';
    jwk.alg = 'RS256';

    const idToken = await new SignJWT({
      email: 'alice@example.com',
      name: 'Alice',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setIssuer('https://idp.example.com')
      .setAudience('cid')
      .setSubject('subject-abc')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    let fetchCallIdx = 0;
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      fetchCallIdx += 1;
      const u = String(url);
      if (u.endsWith('/.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({
            issuer: 'https://idp.example.com',
            authorization_endpoint: 'https://idp.example.com/authorize',
            token_endpoint: 'https://idp.example.com/token',
            jwks_uri: 'https://idp.example.com/jwks',
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      if (u === 'https://idp.example.com/token') {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({ id_token: idToken, access_token: 'at' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u === 'https://idp.example.com/jwks') {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    };

    const result = await exchangeCode(
      makeConfig({
        issuer: 'https://idp.example.com',
        clientId: 'cid',
        clientSecret: 'csec',
      }),
      {
        code: 'authcode',
        redirectUri: 'http://localhost:3000/api/sso/oidc/callback/i1',
      },
      fetchImpl as typeof fetch,
    );
    expect(result.sub).toBe('subject-abc');
    expect(result.claims.email).toBe('alice@example.com');
    expect(result.claims.name).toBe('Alice');
    expect(fetchCallIdx).toBeGreaterThanOrEqual(2); // discovery + token (+ jwks)
  });
});
