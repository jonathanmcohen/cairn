import { createLocalJWKSet, jwtVerify } from 'jose';
import type { IdpConfiguration } from '@/db/schema/sso';

/** Subset of the OIDC discovery doc we actually use. */
export type OidcMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
};

type OidcConfigMetadata = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes?: string;
};

function readOidcConfig(idpConfig: IdpConfiguration): OidcConfigMetadata {
  const m = idpConfig.metadata as Partial<OidcConfigMetadata> | null;
  if (!m || typeof m !== 'object') throw new Error('idp metadata missing');
  if (typeof m.issuer !== 'string' || !m.issuer.startsWith('http')) {
    throw new Error('invalid idp issuer');
  }
  if (typeof m.clientId !== 'string' || m.clientId.length === 0) {
    throw new Error('invalid idp clientId');
  }
  if (typeof m.clientSecret !== 'string' || m.clientSecret.length === 0) {
    throw new Error('invalid idp clientSecret');
  }
  return {
    issuer: m.issuer.replace(/\/$/, ''),
    clientId: m.clientId,
    clientSecret: m.clientSecret,
    scopes: typeof m.scopes === 'string' ? m.scopes : undefined,
  };
}

export async function getOidcMetadata(
  idpConfig: IdpConfiguration,
  fetchImpl: typeof fetch = fetch,
): Promise<OidcMetadata> {
  const { issuer } = readOidcConfig(idpConfig);
  const url = `${issuer}/.well-known/openid-configuration`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
  const doc = (await res.json()) as OidcMetadata;
  if (
    typeof doc.authorization_endpoint !== 'string' ||
    typeof doc.token_endpoint !== 'string' ||
    typeof doc.jwks_uri !== 'string'
  ) {
    throw new Error('OIDC discovery doc missing required endpoints');
  }
  return doc;
}

export async function buildAuthRequest(
  idpConfig: IdpConfiguration,
  input: { state: string; nonce: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const cfg = readOidcConfig(idpConfig);
  const meta = await getOidcMetadata(idpConfig, fetchImpl);
  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', cfg.scopes ?? 'openid email profile');
  u.searchParams.set('redirect_uri', input.redirectUri);
  u.searchParams.set('state', input.state);
  u.searchParams.set('nonce', input.nonce);
  return u.toString();
}

export type ExchangeResult = {
  sub: string;
  claims: Record<string, unknown>;
};

export async function exchangeCode(
  idpConfig: IdpConfiguration,
  input: { code: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeResult> {
  const cfg = readOidcConfig(idpConfig);
  const meta = await getOidcMetadata(idpConfig, fetchImpl);

  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', input.code);
  form.set('redirect_uri', input.redirectUri);
  form.set('client_id', cfg.clientId);
  form.set('client_secret', cfg.clientSecret);

  const tokenRes = await fetchImpl(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    console.error('OIDC token exchange failed', {
      status: tokenRes.status,
      body: body.slice(0, 500),
    });
    throw new Error(`OIDC token exchange failed (${tokenRes.status})`);
  }
  const tokenBody = (await tokenRes.json()) as { id_token?: string; access_token?: string };
  if (typeof tokenBody.id_token !== 'string') {
    throw new Error('OIDC token response missing id_token');
  }

  // Fetch the JWKS using the injected fetch so tests can stub it, then build a
  // local-key resolver from the parsed JWKS. (createRemoteJWKSet doesn't accept
  // a custom fetch in stable jose 6, and we want full test isolation.)
  const jwksRes = await fetchImpl(meta.jwks_uri);
  if (!jwksRes.ok) {
    throw new Error(`OIDC JWKS fetch failed (${jwksRes.status})`);
  }
  const jwksDoc = (await jwksRes.json()) as { keys?: unknown[] };
  if (!jwksDoc.keys || !Array.isArray(jwksDoc.keys)) {
    throw new Error('OIDC JWKS doc missing keys');
  }
  const jwks = createLocalJWKSet({
    keys: jwksDoc.keys as Parameters<typeof createLocalJWKSet>[0]['keys'],
  });

  const { payload } = await jwtVerify(tokenBody.id_token, jwks, {
    issuer: meta.issuer,
    audience: cfg.clientId,
  });

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('id_token missing sub claim');
  }
  return {
    sub: payload.sub,
    claims: payload as Record<string, unknown>,
  };
}
