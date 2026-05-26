import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintScimToken } from '@/lib/sso/scim-token';
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

async function seedTokenWorkspaceMembers(): Promise<{
  raw: string;
  workspaceId: string;
  editorUserId: string;
  viewerUserId: string;
}> {
  const [admin] = await db
    .insert(schema.users)
    .values({
      email: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@x`,
      name: 'A',
      passwordHash: 'x',
    })
    .returning({ id: schema.users.id });
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'WS', slug: `ws-${Math.random().toString(36).slice(2, 10)}` })
    .returning({ id: schema.workspaces.id });
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: ws!.id, userId: admin!.id, role: 'admin' });

  const [editor] = await db
    .insert(schema.users)
    .values({ email: 'e@x', name: 'E', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  const [viewer] = await db
    .insert(schema.users)
    .values({ email: 'v@x', name: 'V', passwordHash: 'x' })
    .returning({ id: schema.users.id });
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: ws!.id, userId: editor!.id, role: 'editor' });
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: ws!.id, userId: viewer!.id, role: 'viewer' });

  const { raw, hash } = mintScimToken();
  await db.insert(schema.scimTokens).values({
    workspaceId: ws!.id,
    tokenHash: hash,
    name: 't',
    scopes: ['groups:read', 'groups:write'],
    createdBy: admin!.id,
  });
  return { raw, workspaceId: ws!.id, editorUserId: editor!.id, viewerUserId: viewer!.id };
}

describe('SCIM /Groups', () => {
  it('GET list returns the three role groups', async () => {
    const t = await seedTokenWorkspaceMembers();
    const { GET } = await import('@/app/api/scim/v2/Groups/route');
    const res = await GET(
      new Request('http://localhost/api/scim/v2/Groups', {
        headers: { authorization: `Bearer ${t.raw}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      Resources: Array<{ id: string; displayName: string; members: unknown[] }>;
    };
    const ids = body.Resources.map((r) => r.id).sort();
    expect(ids).toEqual(['admin', 'editor', 'viewer']);
  });

  it('GET /editor returns just the editor-role members', async () => {
    const t = await seedTokenWorkspaceMembers();
    const { GET } = await import('@/app/api/scim/v2/Groups/[id]/route');
    const res = await GET(
      new Request('http://localhost/api/scim/v2/Groups/editor', {
        headers: { authorization: `Bearer ${t.raw}` },
      }),
      { params: Promise.resolve({ id: 'editor' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: Array<{ value: string }> };
    expect(body.members).toHaveLength(1);
    expect(body.members[0]!.value).toBe(t.editorUserId);
  });

  it('GET /unknown returns 404', async () => {
    const t = await seedTokenWorkspaceMembers();
    const { GET } = await import('@/app/api/scim/v2/Groups/[id]/route');
    const res = await GET(
      new Request('http://localhost/api/scim/v2/Groups/notarole', {
        headers: { authorization: `Bearer ${t.raw}` },
      }),
      { params: Promise.resolve({ id: 'notarole' }) },
    );
    expect(res.status).toBe(404);
  });

  it('PATCH add moves a user into a role', async () => {
    const t = await seedTokenWorkspaceMembers();
    const { PATCH } = await import('@/app/api/scim/v2/Groups/[id]/route');
    const res = await PATCH(
      new Request('http://localhost/api/scim/v2/Groups/admin', {
        method: 'PATCH',
        headers: { authorization: `Bearer ${t.raw}`, 'content-type': 'application/scim+json' },
        body: JSON.stringify({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'add', path: 'members', value: [{ value: t.editorUserId }] }],
        }),
      }),
      { params: Promise.resolve({ id: 'admin' }) },
    );
    expect(res.status).toBe(200);
    const [m] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, t.workspaceId),
          eq(schema.workspaceMembers.userId, t.editorUserId),
        ),
      );
    expect(m!.role).toBe('admin');
  });

  it('POST returns 403 (fixed role enum)', async () => {
    const t = await seedTokenWorkspaceMembers();
    const { POST } = await import('@/app/api/scim/v2/Groups/route');
    const res = await POST(
      new Request('http://localhost/api/scim/v2/Groups', {
        method: 'POST',
        headers: { authorization: `Bearer ${t.raw}`, 'content-type': 'application/scim+json' },
        body: JSON.stringify({ displayName: 'NewGroup', members: [] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('DELETE returns 403 (fixed role enum)', async () => {
    const t = await seedTokenWorkspaceMembers();
    const { DELETE } = await import('@/app/api/scim/v2/Groups/[id]/route');
    const res = await DELETE(
      new Request('http://localhost/api/scim/v2/Groups/editor', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${t.raw}` },
      }),
      { params: Promise.resolve({ id: 'editor' }) },
    );
    expect(res.status).toBe(403);
  });
});
