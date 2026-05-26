import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { generateSamlSpKeypair } from '@/lib/sso/saml-keypair';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE scim_tokens, external_identities, idp_configurations, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seed(): Promise<{ idpId: string }> {
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2, 10)}` })
    .returning({ id: schema.workspaces.id });
  const kp = await generateSamlSpKeypair({
    entityId: 'http://localhost:3000/api/sso/saml/metadata/X',
  });
  const [idp] = await db
    .insert(schema.idpConfigurations)
    .values({
      workspaceId: ws!.id,
      type: 'saml',
      name: 'Okta',
      metadata: {
        sp: {
          entityId: 'http://localhost:3000/api/sso/saml/metadata/X',
          acsUrl: 'http://localhost:3000/api/sso/saml/callback/X',
          privateKeyPem: kp.privateKeyPem,
          certPem: kp.certPem,
        },
        idp: {
          entityId: 'urn:okta',
          ssoUrl: 'https://okta.example/sso',
          x509Cert: 'MIIIDUMMY',
        },
      },
      attributeMap: {},
      enabled: true,
    })
    .returning({ id: schema.idpConfigurations.id });
  return { idpId: idp!.id };
}

describe('GET /api/sso/saml/metadata/[idpId]', () => {
  it('returns SP metadata XML with SPSSODescriptor', async () => {
    const { idpId } = await seed();
    const { GET } = await import('@/app/api/sso/saml/metadata/[idpId]/route');
    const res = await GET(new Request(`http://localhost:3000/api/sso/saml/metadata/${idpId}`), {
      params: Promise.resolve({ idpId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/xml/i);
    const text = await res.text();
    expect(text).toContain('SPSSODescriptor');
    expect(text).toContain('AssertionConsumerService');
  });

  it('returns 404 for unknown idpId', async () => {
    const { GET } = await import('@/app/api/sso/saml/metadata/[idpId]/route');
    const res = await GET(
      new Request(
        'http://localhost:3000/api/sso/saml/metadata/00000000-0000-0000-0000-000000000000',
      ),
      { params: Promise.resolve({ idpId: '00000000-0000-0000-0000-000000000000' }) },
    );
    expect(res.status).toBe(404);
  });
});
