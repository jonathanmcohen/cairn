import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { signOidcState } from '@/lib/sso/oidc-state';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

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

const originalFetch = globalThis.fetch;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'z'.repeat(48);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE scim_tokens, external_identities, idp_configurations, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  const headers = (await import('next/headers')) as unknown as {
    __store: Map<string, unknown>;
  };
  headers.__store.clear();
});

async function setup(opts: { existingUserEmail?: string }): Promise<{
  idpId: string;
  workspaceId: string;
  privateKey: CryptoKey;
  publicJwk: Record<string, unknown>;
  existingUserId: string | null;
}> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'k1';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2, 10)}` })
    .returning({ id: schema.workspaces.id });

  const [idp] = await db
    .insert(schema.idpConfigurations)
    .values({
      workspaceId: ws!.id,
      type: 'oidc',
      name: 'Okta',
      metadata: {
        issuer: 'https://idp.example.com',
        clientId: 'cid',
        clientSecret: 'csec',
      },
      attributeMap: { email: 'email' },
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

  return {
    idpId: idp!.id,
    workspaceId: ws!.id,
    privateKey,
    publicJwk: jwk as unknown as Record<string, unknown>,
    existingUserId,
  };
}

function stubFetchFor(opts: { idToken: string; publicJwk: Record<string, unknown> }) {
  globalThis.fetch = (async (url: string | URL) => {
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
      return new Response(JSON.stringify({ id_token: opts.idToken }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u === 'https://idp.example.com/jwks') {
      return new Response(JSON.stringify({ keys: [opts.publicJwk] }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
}

async function mintIdToken(
  privateKey: CryptoKey,
  claims: { sub: string; email: string; name: string },
): Promise<string> {
  return new SignJWT({ email: claims.email, name: claims.name })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://idp.example.com')
    .setAudience('cid')
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('GET /api/sso/oidc/callback/[idpId]', () => {
  it('links to an existing user by email, upserts external_identity, mints session cookie', async () => {
    const ctx = await setup({ existingUserEmail: 'alice@example.com' });
    const idToken = await mintIdToken(ctx.privateKey, {
      sub: 'subj-1',
      email: 'alice@example.com',
      name: 'Alice',
    });
    stubFetchFor({ idToken, publicJwk: ctx.publicJwk });

    const stateValue = await signOidcState({
      idpId: ctx.idpId,
      nonce: 'n1',
      returnTo: '/pages/abc',
    });
    const headers = (await import('next/headers')) as unknown as {
      __store: Map<string, { name: string; value: string }>;
    };
    headers.__store.set(`cairn_oidc_state_${ctx.idpId}`, {
      name: `cairn_oidc_state_${ctx.idpId}`,
      value: stateValue,
    });

    const { GET } = await import('@/app/api/sso/oidc/callback/[idpId]/route');
    const req = new Request(
      `http://localhost:3000/api/sso/oidc/callback/${ctx.idpId}?code=AC&state=${encodeURIComponent(stateValue)}`,
    );
    const res = await GET(req, { params: Promise.resolve({ idpId: ctx.idpId }) });

    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toMatch(/\/pages\/abc$/);

    // Session cookie set:
    expect(headers.__store.get('next-auth.session-token')).toBeDefined();

    // external_identities upserted:
    const links = await db
      .select()
      .from(schema.externalIdentities)
      .where(eq(schema.externalIdentities.idpConfigId, ctx.idpId));
    expect(links).toHaveLength(1);
    expect(links[0]!.userId).toBe(ctx.existingUserId);
    expect(links[0]!.externalId).toBe('subj-1');
  });

  it('provisions a new user + workspace_member when no email match', async () => {
    const ctx = await setup({});
    const idToken = await mintIdToken(ctx.privateKey, {
      sub: 'subj-2',
      email: 'bob@example.com',
      name: 'Bob',
    });
    stubFetchFor({ idToken, publicJwk: ctx.publicJwk });

    const stateValue = await signOidcState({
      idpId: ctx.idpId,
      nonce: 'n2',
      returnTo: '/',
    });
    const headers = (await import('next/headers')) as unknown as {
      __store: Map<string, { name: string; value: string }>;
    };
    headers.__store.set(`cairn_oidc_state_${ctx.idpId}`, {
      name: `cairn_oidc_state_${ctx.idpId}`,
      value: stateValue,
    });

    const { GET } = await import('@/app/api/sso/oidc/callback/[idpId]/route');
    const req = new Request(
      `http://localhost:3000/api/sso/oidc/callback/${ctx.idpId}?code=AC&state=${encodeURIComponent(stateValue)}`,
    );
    const res = await GET(req, { params: Promise.resolve({ idpId: ctx.idpId }) });
    expect(res.status).toBe(302);

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'));
    expect(users).toHaveLength(1);
    const members = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, users[0]!.id));
    expect(members).toHaveLength(1);
    expect(members[0]!.workspaceId).toBe(ctx.workspaceId);
  });

  it('returns 400 when state cookie is missing', async () => {
    const ctx = await setup({});
    const { GET } = await import('@/app/api/sso/oidc/callback/[idpId]/route');
    const res = await GET(
      new Request(`http://localhost:3000/api/sso/oidc/callback/${ctx.idpId}?code=AC&state=zz`),
      { params: Promise.resolve({ idpId: ctx.idpId }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when state cookie does not match query string', async () => {
    const ctx = await setup({});
    const goodState = await signOidcState({
      idpId: ctx.idpId,
      nonce: 'n',
      returnTo: '/',
    });
    const headers = (await import('next/headers')) as unknown as {
      __store: Map<string, { name: string; value: string }>;
    };
    headers.__store.set(`cairn_oidc_state_${ctx.idpId}`, {
      name: `cairn_oidc_state_${ctx.idpId}`,
      value: goodState,
    });
    const { GET } = await import('@/app/api/sso/oidc/callback/[idpId]/route');
    const res = await GET(
      new Request(
        `http://localhost:3000/api/sso/oidc/callback/${ctx.idpId}?code=AC&state=different`,
      ),
      { params: Promise.resolve({ idpId: ctx.idpId }) },
    );
    expect(res.status).toBe(400);
  });
});
