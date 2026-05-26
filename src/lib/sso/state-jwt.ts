import { jwtVerify, SignJWT } from 'jose';

/**
 * Shared HS256 JWT primitives for SSO flow state cookies (OIDC + SAML).
 * Both flows store a short-lived signed cookie carrying flow-specific
 * payload (nonce/returnTo for OIDC, AuthnRequest id/returnTo for SAML).
 * Centralising the signer keeps key-derivation + algorithm consistent.
 */

function key(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET missing or too short (need >=32 chars)');
  }
  return new TextEncoder().encode(secret);
}

export async function signStateJwt(
  payload: Record<string, unknown>,
  opts: { ttlSeconds?: number } = {},
): Promise<string> {
  const ttl = opts.ttlSeconds ?? 600;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(key());
}

export async function verifyStateJwt(value: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(value, key(), { algorithms: ['HS256'] });
  return payload as Record<string, unknown>;
}
