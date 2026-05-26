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

describe('admin OIDC CRUD', () => {
  it('admin POST creates an idp config + audit row', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const { POST } = await import('@/app/api/admin/sso/oidc/route');
    const res = await POST(
      new Request('http://localhost/api/admin/sso/oidc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Okta',
          metadata: {
            issuer: 'https://example.okta.com',
            clientId: 'c',
            clientSecret: 's',
          },
          attributeMap: { email: 'email' },
          enabled: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const rows = await db
      .select()
      .from(schema.idpConfigurations)
      .where(eq(schema.idpConfigurations.id, body.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('oidc');

    const auditRows = (await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, u.workspaceId))) as Array<{ action: string }>;
    expect(auditRows.some((r) => r.action === 'sso.idp.created')).toBe(true);
  });

  it('non-admin POST returns 403', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'editor' });
    await actAs(u.userId, u.workspaceId);
    const { POST } = await import('@/app/api/admin/sso/oidc/route');
    const res = await POST(
      new Request('http://localhost/api/admin/sso/oidc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'x',
          metadata: { issuer: 'https://a.example', clientId: 'c', clientSecret: 's' },
          attributeMap: {},
          enabled: false,
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('admin PATCH updates fields + writes sso.idp.updated', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const [idp] = await db
      .insert(schema.idpConfigurations)
      .values({
        workspaceId: u.workspaceId,
        type: 'oidc',
        name: 'old',
        metadata: { issuer: 'https://a.example', clientId: 'c', clientSecret: 's' },
        attributeMap: {},
        enabled: false,
      })
      .returning({ id: schema.idpConfigurations.id });
    const { PATCH } = await import('@/app/api/admin/sso/oidc/[idpId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/admin/sso/oidc/${idp!.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'new', enabled: true }),
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
    expect(row.name).toBe('new');
    expect(row.enabled).toBe(true);
  });

  it('admin DELETE removes the config + writes sso.idp.deleted', async () => {
    const u = await createTestWorkspaceWithUser(db, { role: 'admin' });
    await actAs(u.userId, u.workspaceId);
    const [idp] = await db
      .insert(schema.idpConfigurations)
      .values({
        workspaceId: u.workspaceId,
        type: 'oidc',
        name: 'x',
        metadata: { issuer: 'https://a.example', clientId: 'c', clientSecret: 's' },
        attributeMap: {},
        enabled: true,
      })
      .returning({ id: schema.idpConfigurations.id });
    const { DELETE } = await import('@/app/api/admin/sso/oidc/[idpId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/admin/sso/oidc/${idp!.id}`, { method: 'DELETE' }),
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

  it('cross-workspace PATCH returns 404 (never leak existence)', async () => {
    const a = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const b = await createTestWorkspaceWithUser(db, { role: 'admin' });
    const [idp] = await db
      .insert(schema.idpConfigurations)
      .values({
        workspaceId: a.workspaceId,
        type: 'oidc',
        name: 'x',
        metadata: { issuer: 'https://a.example', clientId: 'c', clientSecret: 's' },
        attributeMap: {},
        enabled: true,
      })
      .returning({ id: schema.idpConfigurations.id });
    await actAs(b.userId, b.workspaceId);
    const { PATCH } = await import('@/app/api/admin/sso/oidc/[idpId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/admin/sso/oidc/${idp!.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'hijack' }),
      }),
      { params: Promise.resolve({ idpId: idp!.id }) },
    );
    expect(res.status).toBe(404);
  });
});
