import { signStateJwt, verifyStateJwt } from '@/lib/sso/state-jwt';

/**
 * SAML init→callback state cookie payload. `requestId` is the AuthnRequest
 * ID samlify minted at init time; the callback validates the IdP's
 * `InResponseTo` matches it (replay protection). `returnTo` is the
 * post-login redirect target.
 */
export type SamlStatePayload = {
  idpId: string;
  requestId: string;
  returnTo: string;
};

export async function signSamlState(
  input: SamlStatePayload & { ttlSeconds?: number },
): Promise<string> {
  return signStateJwt(
    {
      idpId: input.idpId,
      requestId: input.requestId,
      returnTo: input.returnTo,
    },
    { ttlSeconds: input.ttlSeconds },
  );
}

export async function verifySamlState(
  value: string,
  expectedIdpId: string,
): Promise<SamlStatePayload> {
  const payload = await verifyStateJwt(value);
  const idpId = payload.idpId;
  const requestId = payload.requestId;
  const returnTo = payload.returnTo;
  if (typeof idpId !== 'string' || typeof requestId !== 'string' || typeof returnTo !== 'string') {
    throw new Error('invalid state payload shape');
  }
  if (idpId !== expectedIdpId) {
    throw new Error('idp mismatch');
  }
  return { idpId, requestId, returnTo };
}
