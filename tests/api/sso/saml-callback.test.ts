import * as validator from '@authenio/samlify-node-xmllint';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as samlify from 'samlify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { generateSamlSpKeypair } from '@/lib/sso/saml-keypair';
import { signSamlState } from '@/lib/sso/saml-state';
import { startPostgres, stopPostgres } from '../../helpers/db';

vi.mock('next/headers', () => {
  const store = new Map<
    string,
    { name: string; value: string; options?: Record<string, unknown> }
  >();
  return {
    cookies: async () => ({
      set: (name: string, value: string, options?: Record<string, unknown>) => {
        store.set(name, { name, value, options });
      },
      get: (name: string) => store.get(name),
      delete: (name: string) => store.delete(name),
    }),
    __store: store,
  };
});

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  samlify.setSchemaValidator(validator);
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(48);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE scim_tokens, external_identities, idp_configurations, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  const h = (await import('next/headers')) as unknown as { __store: Map<string, unknown> };
  h.__store.clear();
});

async function setupAndMintResponse(opts: {
  existingUserEmail?: string;
  requestId?: string;
}): Promise<{
  idpId: string;
  workspaceId: string;
  samlResponseB64: string;
  existingUserId: string | null;
  emailUsed: string;
  requestId: string;
}> {
  const spKp = await generateSamlSpKeypair({
    entityId: 'http://localhost:3000/api/sso/saml/metadata/X',
  });
  const idpKp = await generateSamlSpKeypair({ entityId: 'urn:test-idp' });

  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2, 10)}` })
    .returning({ id: schema.workspaces.id });

  const idpCertBody = idpKp.certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');

  const [idp] = await db
    .insert(schema.idpConfigurations)
    .values({
      workspaceId: ws!.id,
      type: 'saml',
      name: 'TestIdP',
      metadata: {
        sp: {
          entityId: 'http://localhost:3000/api/sso/saml/metadata/X',
          acsUrl: 'http://localhost:3000/api/sso/saml/callback/X',
          privateKeyPem: spKp.privateKeyPem,
          certPem: spKp.certPem,
        },
        idp: {
          entityId: 'urn:test-idp',
          ssoUrl: 'http://idp.example/sso',
          x509Cert: idpCertBody,
        },
      },
      attributeMap: { email: 'email', name: 'name' },
      enabled: true,
    })
    .returning({ id: schema.idpConfigurations.id });

  let existingUserId: string | null = null;
  if (opts.existingUserEmail) {
    const [u] = await db
      .insert(schema.users)
      .values({ email: opts.existingUserEmail, name: 'Existing', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    existingUserId = u!.id;
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws!.id, userId: u!.id, role: 'editor' });
  }

  // Have a signing IdP mint a SAMLResponse asserting nameID = email.
  // Default samlify response template only carries email via NameID — the
  // production route falls back to `nameId` when the configured email
  // attribute is missing (see callback's `email = attrs[k] ?? nameId`).
  const signingIdp = samlify.IdentityProvider({
    entityID: 'urn:test-idp',
    privateKey: idpKp.privateKeyPem,
    signingCert: idpCertBody,
    isAssertionEncrypted: false,
    singleSignOnService: [
      {
        Binding: samlify.Constants.namespace.binding.redirect,
        Location: 'http://idp.example/sso',
      },
    ],
  });
  const wrapperSp = samlify.ServiceProvider({
    entityID: 'http://localhost:3000/api/sso/saml/metadata/X',
    privateKey: spKp.privateKeyPem,
    assertionConsumerService: [
      {
        Binding: samlify.Constants.namespace.binding.post,
        Location: 'http://localhost:3000/api/sso/saml/callback/X',
      },
    ],
  });
  const email = opts.existingUserEmail ?? 'bob@example.com';
  const requestId = opts.requestId ?? '_fake-req-id_42abcd';
  const synthetic = await signingIdp.createLoginResponse(
    wrapperSp,
    { extract: { request: { id: requestId } } } as never,
    'post',
    { email, name: 'User', nameID: email } as never,
  );

  return {
    idpId: idp!.id,
    workspaceId: ws!.id,
    samlResponseB64: (synthetic as { context: string }).context,
    existingUserId,
    emailUsed: email,
    requestId,
  };
}

async function seedSamlStateCookie(idpId: string, requestId: string): Promise<void> {
  const h = (await import('next/headers')) as unknown as {
    __store: Map<string, { name: string; value: string }>;
  };
  const value = await signSamlState({ idpId, requestId, returnTo: '/' });
  h.__store.set(`cairn_saml_state_${idpId}`, {
    name: `cairn_saml_state_${idpId}`,
    value,
  });
}

describe('POST /api/sso/saml/callback/[idpId]', () => {
  it('parses SAMLResponse, links existing user, mints session cookie', async () => {
    const setup = await setupAndMintResponse({ existingUserEmail: 'alice@example.com' });
    await seedSamlStateCookie(setup.idpId, setup.requestId);
    const body = new URLSearchParams();
    body.set('SAMLResponse', setup.samlResponseB64);

    const { POST } = await import('@/app/api/sso/saml/callback/[idpId]/route');
    const res = await POST(
      new Request(`http://localhost:3000/api/sso/saml/callback/${setup.idpId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }),
      { params: Promise.resolve({ idpId: setup.idpId }) },
    );
    expect(res.status).toBe(302);

    const headers = (await import('next/headers')) as unknown as {
      __store: Map<string, { name: string; value: string }>;
    };
    expect(headers.__store.get('next-auth.session-token')).toBeDefined();

    const links = await db
      .select()
      .from(schema.externalIdentities)
      .where(eq(schema.externalIdentities.idpConfigId, setup.idpId));
    expect(links).toHaveLength(1);
    expect(links[0]!.userId).toBe(setup.existingUserId);
  });

  it('provisions new user when no email match', async () => {
    const setup = await setupAndMintResponse({});
    await seedSamlStateCookie(setup.idpId, setup.requestId);
    const body = new URLSearchParams();
    body.set('SAMLResponse', setup.samlResponseB64);
    const { POST } = await import('@/app/api/sso/saml/callback/[idpId]/route');
    const res = await POST(
      new Request(`http://localhost:3000/api/sso/saml/callback/${setup.idpId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }),
      { params: Promise.resolve({ idpId: setup.idpId }) },
    );
    expect(res.status).toBe(302);
    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, setup.emailUsed));
    expect(users).toHaveLength(1);
  });

  it('returns 400 on missing SAMLResponse', async () => {
    const setup = await setupAndMintResponse({});
    await seedSamlStateCookie(setup.idpId, setup.requestId);
    const { POST } = await import('@/app/api/sso/saml/callback/[idpId]/route');
    const res = await POST(
      new Request(`http://localhost:3000/api/sso/saml/callback/${setup.idpId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '',
      }),
      { params: Promise.resolve({ idpId: setup.idpId }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when InResponseTo does not match the init-time AuthnRequest id', async () => {
    const setup = await setupAndMintResponse({ requestId: '_response-says-this-id_' });
    // Seed a state cookie whose requestId is DIFFERENT from the one baked
    // into the synthetic SAMLResponse → callback must reject.
    await seedSamlStateCookie(setup.idpId, '_init-time-different-id_');
    const body = new URLSearchParams();
    body.set('SAMLResponse', setup.samlResponseB64);
    const { POST } = await import('@/app/api/sso/saml/callback/[idpId]/route');
    const res = await POST(
      new Request(`http://localhost:3000/api/sso/saml/callback/${setup.idpId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }),
      { params: Promise.resolve({ idpId: setup.idpId }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when state cookie is missing', async () => {
    const setup = await setupAndMintResponse({});
    // No seedSamlStateCookie call — cookie absent.
    const body = new URLSearchParams();
    body.set('SAMLResponse', setup.samlResponseB64);
    const { POST } = await import('@/app/api/sso/saml/callback/[idpId]/route');
    const res = await POST(
      new Request(`http://localhost:3000/api/sso/saml/callback/${setup.idpId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }),
      { params: Promise.resolve({ idpId: setup.idpId }) },
    );
    expect(res.status).toBe(400);
  });
});
