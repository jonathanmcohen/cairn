import * as validator from '@authenio/samlify-node-xmllint';
import * as samlify from 'samlify';
import type { IdpConfiguration } from '@/db/schema/sso';

// One-time validator registration. samlify is module-singleton — calling
// setSchemaValidator multiple times is safe and idempotent.
let validatorBound = false;
function ensureValidator(): void {
  if (validatorBound) return;
  samlify.setSchemaValidator(validator);
  validatorBound = true;
}

type SpMeta = {
  entityId: string;
  acsUrl: string;
  privateKeyPem: string;
  certPem: string;
};
type IdpMeta = {
  entityId: string;
  ssoUrl: string;
  x509Cert: string; // base64 cert body (no BEGIN/END headers, no whitespace)
};

function readMeta(idpConfig: IdpConfiguration): { sp: SpMeta; idp: IdpMeta } {
  const m = idpConfig.metadata as { sp?: SpMeta; idp?: IdpMeta } | null;
  if (!m || !m.sp || !m.idp) throw new Error('idp metadata missing sp/idp blocks');
  return { sp: m.sp, idp: m.idp };
}

export function getServiceProvider(idpConfig: IdpConfiguration): samlify.ServiceProviderInstance {
  ensureValidator();
  const { sp } = readMeta(idpConfig);
  return samlify.ServiceProvider({
    entityID: sp.entityId,
    privateKey: sp.privateKeyPem,
    assertionConsumerService: [
      {
        Binding: samlify.Constants.namespace.binding.post,
        Location: sp.acsUrl,
      },
    ],
  });
}

export function getIdentityProvider(idpConfig: IdpConfiguration): samlify.IdentityProviderInstance {
  ensureValidator();
  const { idp } = readMeta(idpConfig);
  return samlify.IdentityProvider({
    entityID: idp.entityId,
    signingCert: idp.x509Cert,
    singleSignOnService: [
      { Binding: samlify.Constants.namespace.binding.redirect, Location: idp.ssoUrl },
    ],
    isAssertionEncrypted: false,
  });
}

export async function buildLoginRequest(
  idpConfig: IdpConfiguration,
): Promise<{ requestId: string; url: string }> {
  const sp = getServiceProvider(idpConfig);
  const idp = getIdentityProvider(idpConfig);
  const result = sp.createLoginRequest(idp, 'redirect');
  // samlify's redirect-binding result has shape `{ id, context }` where
  // `context` is the full URL (with SAMLRequest query param) and `id` is
  // the AuthnRequest ID we must validate against the IdP's `InResponseTo`.
  const ctx = (result as { context?: unknown }).context;
  const id = (result as { id?: unknown }).id;
  if (typeof ctx !== 'string' || typeof id !== 'string') {
    throw new Error('samlify createLoginRequest returned unexpected shape');
  }
  return { requestId: id, url: ctx };
}

export type SamlParseResult = {
  nameId: string;
  attributes: Record<string, string>;
  inResponseTo: string | null;
};

export async function parseLoginResponse(
  idpConfig: IdpConfiguration,
  body: { SAMLResponse: string; RelayState?: string },
): Promise<SamlParseResult> {
  const sp = getServiceProvider(idpConfig);
  const idp = getIdentityProvider(idpConfig);
  const result = await sp.parseLoginResponse(idp, 'post', { body });

  const extract = (result as unknown as { extract: Record<string, unknown> }).extract;
  const nameId =
    (extract.nameID as string | undefined) ??
    (extract.nameid as string | undefined) ??
    ((extract.nameID as { value?: string } | undefined)?.value as string | undefined);
  if (typeof nameId !== 'string') throw new Error('SAML response missing nameID');

  const rawAttrs = (extract.attributes as Record<string, unknown> | undefined) ?? {};
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawAttrs)) {
    if (typeof v === 'string') attributes[k] = v;
    else if (Array.isArray(v) && typeof v[0] === 'string') attributes[k] = v[0];
  }
  // samlify lowercases attribute names; `response.inResponseTo` is the
  // <Response InResponseTo="..."> attribute from the IdP. Required for
  // replay protection (P3 review fix).
  const response = (extract.response as Record<string, unknown> | undefined) ?? {};
  const irt = response.inResponseTo;
  const inResponseTo = typeof irt === 'string' && irt.length > 0 ? irt : null;
  return { nameId, attributes, inResponseTo };
}

/** Returns the SP metadata XML for this IdP config (served by the SP-metadata route). */
export function getSpMetadataXml(idpConfig: IdpConfiguration): string {
  const sp = getServiceProvider(idpConfig);
  return sp.getMetadata();
}
