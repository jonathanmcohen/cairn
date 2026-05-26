import { jwtVerify, SignJWT } from 'jose';

/**
 * State cookie payload signed with AUTH_SECRET (HS256). Carries the IdP id so
 * the callback can re-verify the trip is consistent, a per-request nonce to
 * mix into the auth URL, and a return URL the callback redirects to on
 * success. 10-minute default TTL.
 */
export type OidcStatePayload = {
  idpId: string;
  nonce: string;
  returnTo: string;
};

function key(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET missing or too short (need >=32 chars)');
  }
  return new TextEncoder().encode(secret);
}

export async function signOidcState(
  input: OidcStatePayload & { ttlSeconds?: number },
): Promise<string> {
  const ttl = input.ttlSeconds ?? 600;
  return new SignJWT({
    idpId: input.idpId,
    nonce: input.nonce,
    returnTo: input.returnTo,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(key());
}

export async function verifyOidcState(
  value: string,
  expectedIdpId: string,
): Promise<OidcStatePayload> {
  const { payload } = await jwtVerify(value, key(), { algorithms: ['HS256'] });
  const idpId = payload.idpId;
  const nonce = payload.nonce;
  const returnTo = payload.returnTo;
  if (typeof idpId !== 'string' || typeof nonce !== 'string' || typeof returnTo !== 'string') {
    throw new Error('invalid state payload shape');
  }
  if (idpId !== expectedIdpId) {
    throw new Error('idp mismatch');
  }
  return { idpId, nonce, returnTo };
}
