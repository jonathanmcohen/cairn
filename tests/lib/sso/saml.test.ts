import * as validator from '@authenio/samlify-node-xmllint';
import * as samlify from 'samlify';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IdpConfiguration } from '@/db/schema/sso';
import { buildLoginRequest, parseLoginResponse } from '@/lib/sso/saml';
import { generateSamlSpKeypair } from '@/lib/sso/saml-keypair';

beforeAll(() => {
  samlify.setSchemaValidator(validator);
});

function ts(): IdpConfiguration {
  return {
    id: 'i1',
    workspaceId: 'w1',
    type: 'saml',
    name: 'IdP',
    metadata: {},
    attributeMap: {
      email: 'urn:oid:1.2.840.113549.1.9.1',
      name: 'urn:oid:2.16.840.1.113730.3.1.241',
    },
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as IdpConfiguration;
}

describe('SAML wrapper round-trip', () => {
  it('mints a SAMLResponse via a fixture IdP and our wrapper parses it back', async () => {
    // (1) SP keypair + metadata stored on idpConfig.metadata.sp
    const sp = await generateSamlSpKeypair({
      entityId: 'http://localhost:3000/api/sso/saml/metadata/i1',
    });
    // (2) IdP keypair to sign the response
    const idp = await generateSamlSpKeypair({
      entityId: 'urn:test-idp',
    });
    const idpCertBody = idp.certPem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, '');

    const idpConfig: IdpConfiguration = {
      ...ts(),
      metadata: {
        sp: {
          entityId: 'http://localhost:3000/api/sso/saml/metadata/i1',
          acsUrl: 'http://localhost:3000/api/sso/saml/callback/i1',
          privateKeyPem: sp.privateKeyPem,
          certPem: sp.certPem,
        },
        idp: {
          entityId: 'urn:test-idp',
          ssoUrl: 'http://idp.example/sso',
          x509Cert: idpCertBody,
        },
      },
    } as unknown as IdpConfiguration;

    // Build a samlify IdP for SIGNING — mirror getIdentityProvider but with
    // the private key included so it can sign the synthetic SAMLResponse.
    const signingIdp = samlify.IdentityProvider({
      entityID: 'urn:test-idp',
      privateKey: idp.privateKeyPem,
      signingCert: idpCertBody,
      isAssertionEncrypted: false,
      messageSigningOrder: 'sign-then-encrypt',
      wantLogoutRequestSigned: false,
      singleSignOnService: [
        {
          Binding: samlify.Constants.namespace.binding.redirect,
          Location: 'http://idp.example/sso',
        },
      ],
    });

    // Build SP via wrapper (same shape the production route would).
    const wrapperSp = samlify.ServiceProvider({
      entityID: 'http://localhost:3000/api/sso/saml/metadata/i1',
      privateKey: sp.privateKeyPem,
      assertionConsumerService: [
        {
          Binding: samlify.Constants.namespace.binding.post,
          Location: 'http://localhost:3000/api/sso/saml/callback/i1',
        },
      ],
    });

    // Have the IdP mint a synthetic SAMLResponse with nameID + email attribute.
    // The `binding` arg here is the SHORT key ('post' | 'redirect' | 'simpleSign'),
    // not the full URN — samlify looks it up via namespace.binding[binding].
    const synthetic = await signingIdp.createLoginResponse(
      wrapperSp,
      { extract: { request: { id: '_fake-req-id_42abcd' } } } as never,
      'post',
      {
        email: 'alice@example.com',
        nameID: 'alice@example.com',
      } as never,
    );

    // The samlify createLoginResponse returns { id, context, entityEndpoint }
    // where `context` is the base64 SAMLResponse. Hand it to our wrapper.
    // The default samlify response template carries the email via NameID;
    // attribute statements only appear when the IdP is constructed with a
    // `loginResponseTemplate` containing `{Attributes}`. Production routes
    // fall back to `nameId` when the configured email attribute is absent
    // (see callback route — `email = parsed.attributes[emailKey] ?? parsed.nameId`).
    const parsed = await parseLoginResponse(idpConfig, {
      SAMLResponse: (synthetic as { context: string }).context,
    });
    expect(parsed.nameId).toBe('alice@example.com');
  });

  it('buildLoginRequest returns a URL on the IdP SSO endpoint with SAMLRequest param', async () => {
    const sp = await generateSamlSpKeypair({
      entityId: 'http://localhost:3000/api/sso/saml/metadata/i1',
    });
    const idpConfig: IdpConfiguration = {
      ...ts(),
      metadata: {
        sp: {
          entityId: 'http://localhost:3000/api/sso/saml/metadata/i1',
          acsUrl: 'http://localhost:3000/api/sso/saml/callback/i1',
          privateKeyPem: sp.privateKeyPem,
          certPem: sp.certPem,
        },
        idp: {
          entityId: 'urn:test-idp',
          ssoUrl: 'http://idp.example/sso',
          x509Cert: 'MIICAEXAMPLE',
        },
      },
    } as unknown as IdpConfiguration;

    const result = await buildLoginRequest(idpConfig);
    const u = new URL(result.url);
    expect(u.origin + u.pathname).toBe('http://idp.example/sso');
    expect(u.searchParams.get('SAMLRequest')).not.toBeNull();
    expect(typeof result.requestId).toBe('string');
    expect(result.requestId.length).toBeGreaterThan(0);
  });
});
