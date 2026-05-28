import { signStateJwt, verifyStateJwt } from '@/lib/sso/state-jwt';

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

export async function signOidcState(
  input: OidcStatePayload & { ttlSeconds?: number },
): Promise<string> {
  return signStateJwt(
    {
      idpId: input.idpId,
      nonce: input.nonce,
      returnTo: input.returnTo,
    },
    { ttlSeconds: input.ttlSeconds },
  );
}

export async function verifyOidcState(
  value: string,
  expectedIdpId: string,
): Promise<OidcStatePayload> {
  const payload = await verifyStateJwt(value);
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
