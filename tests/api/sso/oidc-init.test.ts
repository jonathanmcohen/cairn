import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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

// Inject a custom fetch into the OIDC lib by monkey-patching globalThis.fetch
// for the duration of the test. The route handler reads via the default
// `fetch` global, not a parameter.
const originalFetch = globalThis.fetch;
function stubFetch(handler: (url: string | URL, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = handler as typeof fetch;
}
function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

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
  restoreFetch();
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

async function seedIdp(opts: { enabled: boolean }): Promise<{ idpId: string }> {
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
      enabled: opts.enabled,
    })
    .returning({ id: schema.idpConfigurations.id });
  return { idpId: idp!.id };
}

describe('GET /api/sso/oidc/init/[idpId]', () => {
  it('302 redirects to the IdP authorization URL and sets a state cookie', async () => {
    const { idpId } = await seedIdp({ enabled: true });
    stubFetch(async (url) => {
      if (String(url).endsWith('/.well-known/openid-configuration')) {
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
      throw new Error(`unexpected fetch: ${String(url)}`);
    });

    const { GET } = await import('@/app/api/sso/oidc/init/[idpId]/route');
    const res = await GET(new Request(`http://localhost:3000/api/sso/oidc/init/${idpId}`), {
      params: Promise.resolve({ idpId }),
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('https://idp.example.com/authorize')).toBe(true);

    const headers = (await import('next/headers')) as unknown as {
      __store: Map<string, { name: string; value: string }>;
    };
    const cookie = headers.__store.get(`cairn_oidc_state_${idpId}`);
    expect(cookie).toBeDefined();
    expect(cookie!.value.split('.').length).toBe(3);
  });

  it('404 when IdP is disabled', async () => {
    const { idpId } = await seedIdp({ enabled: false });
    const { GET } = await import('@/app/api/sso/oidc/init/[idpId]/route');
    const res = await GET(new Request(`http://localhost:3000/api/sso/oidc/init/${idpId}`), {
      params: Promise.resolve({ idpId }),
    });
    expect(res.status).toBe(404);
  });

  it('404 when IdP id does not exist', async () => {
    const { GET } = await import('@/app/api/sso/oidc/init/[idpId]/route');
    const res = await GET(
      new Request(`http://localhost:3000/api/sso/oidc/init/00000000-0000-0000-0000-000000000000`),
      { params: Promise.resolve({ idpId: '00000000-0000-0000-0000-000000000000' }) },
    );
    expect(res.status).toBe(404);
  });
});
