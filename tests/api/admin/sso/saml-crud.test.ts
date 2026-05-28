import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../../helpers/db';
import { createTestWorkspaceWithUser } from '../../../helpers/fixtures';

let activeCookie: { name: string; value: string } | undefined;

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => activeCookie,
    set: () => {},
    delete: () => {},
  }),
}));

async function actAs(userId: string, workspaceId: string): Promise<void> {
  const a = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  a.__set({ userId });
  activeCookie = { name: 'cairn_ws', value: workspaceId };
}

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

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
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE scim_tokens, external_identities, idp_configurations, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  activeCookie = undefined;
});

describe('admin SAML CRUD', () => {
  it('admin POST creates a SAML idp config + audit row + generates SP keypair', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const { POST } = await import('@/app/api/admin/sso/saml/route');
    const res = await POST(
      new Request('http://localhost/api/admin/sso/saml', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Okta',
          idp: {
            entityId: 'urn:okta',
            ssoUrl: 'https://okta.example/sso',
            x509Cert: 'MIIIDUMMYBASE64',
          },
          attributeMap: { email: 'email', name: 'name' },
          enabled: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const [row] = await db
      .select()
      .from(schema.idpConfigurations)
      .where(eq(schema.idpConfigurations.id, body.id));
    expect(row!.type).toBe('saml');
    const meta = row!.metadata as {
      sp: { privateKeyPem: string; certPem: string };
      idp: { entityId: string };
    };
    expect(meta.sp.privateKeyPem).toContain('PRIVATE KEY');
    expect(meta.sp.certPem).toContain('CERTIFICATE');
    expect(meta.idp.entityId).toBe('urn:okta');

    const auditRows = (await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId))) as Array<{ action: string }>;
    expect(auditRows.some((r) => r.action === 'sso.idp.created')).toBe(true);
  });

  it('non-admin POST returns 403', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(u.userId, u.workspaceId);
    const { POST } = await import('@/app/api/admin/sso/saml/route');
    const res = await POST(
      new Request('http://localhost/api/admin/sso/saml', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'x',
          idp: { entityId: 'urn:x', ssoUrl: 'https://x.example', x509Cert: 'XX' },
          attributeMap: {},
          enabled: false,
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('admin PATCH without x509Cert preserves the existing cert', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const [idp] = await db
      .insert(schema.idpConfigurations)
      .values({
        workspaceId: u.workspaceId,
        type: 'saml',
        name: 'orig',
        metadata: {
          sp: {},
          idp: {
            entityId: 'urn:orig',
            ssoUrl: 'https://orig.example/sso',
            x509Cert: 'KEEP-ME-BASE64',
          },
        },
        attributeMap: {},
        enabled: true,
      })
      .returning({ id: schema.idpConfigurations.id });
    const { PATCH } = await import('@/app/api/admin/sso/saml/[idpId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/admin/sso/saml/${idp!.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idp: {
            entityId: 'urn:new',
            ssoUrl: 'https://new.example/sso',
            // x509Cert intentionally omitted — should preserve prior value
          },
        }),
      }),
      { params: Promise.resolve({ idpId: idp!.id }) },
    );
    expect(res.status).toBe(200);
    const row = (
      await db
        .select()
        .from(schema.idpConfigurations)
        .where(eq(schema.idpConfigurations.id, idp!.id))
    )[0]!;
    const meta = row.metadata as { idp: { entityId: string; ssoUrl: string; x509Cert: string } };
    expect(meta.idp.entityId).toBe('urn:new');
    expect(meta.idp.ssoUrl).toBe('https://new.example/sso');
    expect(meta.idp.x509Cert).toBe('KEEP-ME-BASE64');
  });

  it('admin DELETE removes the SAML config + writes sso.idp.deleted', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const [idp] = await db
      .insert(schema.idpConfigurations)
      .values({
        workspaceId: u.workspaceId,
        type: 'saml',
        name: 'x',
        metadata: {
          sp: {},
          idp: { entityId: 'urn:x', ssoUrl: 'https://x.example', x509Cert: 'XX' },
        },
        attributeMap: {},
        enabled: true,
      })
      .returning({ id: schema.idpConfigurations.id });
    const { DELETE } = await import('@/app/api/admin/sso/saml/[idpId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/admin/sso/saml/${idp!.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ idpId: idp!.id }) },
    );
    expect(res.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.idpConfigurations)
        .where(eq(schema.idpConfigurations.id, idp!.id)),
    ).toHaveLength(0);
  });
});
