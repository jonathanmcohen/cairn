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
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE scim_tokens, external_identities, idp_configurations, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

async function seedTokenAndWorkspace(scopes: string[]): Promise<{
  raw: string;
  workspaceId: string;
  userId: string;
}> {
  const [user] = await db
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
    .values({ workspaceId: ws!.id, userId: user!.id, role: 'admin' });
  const { raw, hash } = mintScimToken();
  await db.insert(schema.scimTokens).values({
    workspaceId: ws!.id,
    tokenHash: hash,
    name: 'test',
    scopes,
    createdBy: user!.id,
  });
  return { raw, workspaceId: ws!.id, userId: user!.id };
}

describe('SCIM /Users', () => {
  it('401 when bearer token missing', async () => {
    const { GET } = await import('@/app/api/scim/v2/Users/route');
    const res = await GET(new Request('http://localhost/api/scim/v2/Users'));
    expect(res.status).toBe(401);
  });

  it('401 when bearer token wrong', async () => {
    const { GET } = await import('@/app/api/scim/v2/Users/route');
    const res = await GET(
      new Request('http://localhost/api/scim/v2/Users', {
        headers: { authorization: 'Bearer cairn_scim_wrong' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('POST creates a user + workspace member', async () => {
    const t = await seedTokenAndWorkspace(['users:read', 'users:write']);
    const { POST } = await import('@/app/api/scim/v2/Users/route');
    const res = await POST(
      new Request('http://localhost/api/scim/v2/Users', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${t.raw}`,
          'content-type': 'application/scim+json',
        },
        body: JSON.stringify({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: 'bob@example.com',
          displayName: 'Bob',
          emails: [{ value: 'bob@example.com', primary: true }],
          active: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; userName: string };
    expect(body.userName).toBe('bob@example.com');

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'bob@example.com'));
    expect(users).toHaveLength(1);
    const members = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, t.workspaceId),
          eq(schema.workspaceMembers.userId, users[0]!.id),
        ),
      );
    expect(members).toHaveLength(1);
  });

  it('POST 403 when token missing users:write scope', async () => {
    const t = await seedTokenAndWorkspace(['users:read']);
    const { POST } = await import('@/app/api/scim/v2/Users/route');
    const res = await POST(
      new Request('http://localhost/api/scim/v2/Users', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${t.raw}`,
          'content-type': 'application/scim+json',
        },
        body: JSON.stringify({
          userName: 'x@y.example',
          displayName: 'X',
          emails: [{ value: 'x@y.example' }],
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('GET list with userName eq filter returns matching user', async () => {
    const t = await seedTokenAndWorkspace(['users:read']);
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'carol@x', name: 'Carol', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: t.workspaceId, userId: user!.id, role: 'editor' });

    const { GET } = await import('@/app/api/scim/v2/Users/route');
    const res = await GET(
      new Request(
        `http://localhost/api/scim/v2/Users?filter=${encodeURIComponent('userName eq "carol@x"')}`,
        { headers: { authorization: `Bearer ${t.raw}` } },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      Resources: Array<{ userName: string }>;
      totalResults: number;
    };
    expect(body.totalResults).toBe(1);
    expect(body.Resources[0]!.userName).toBe('carol@x');
  });

  it('GET list with unsupported filter returns 400 invalidFilter', async () => {
    const t = await seedTokenAndWorkspace(['users:read']);
    const { GET } = await import('@/app/api/scim/v2/Users/route');
    const res = await GET(
      new Request(
        `http://localhost/api/scim/v2/Users?filter=${encodeURIComponent('userName co "alice"')}`,
        { headers: { authorization: `Bearer ${t.raw}` } },
      ),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { scimType?: string };
    expect(body.scimType).toBe('invalidFilter');
  });

  it('PATCH replace displayName updates the user row', async () => {
    const t = await seedTokenAndWorkspace(['users:read', 'users:write']);
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'dan@x', name: 'Dan', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: t.workspaceId, userId: user!.id, role: 'editor' });

    const { PATCH } = await import('@/app/api/scim/v2/Users/[id]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/scim/v2/Users/${user!.id}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${t.raw}`, 'content-type': 'application/scim+json' },
        body: JSON.stringify({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', path: 'displayName', value: 'Daniel' }],
        }),
      }),
      { params: Promise.resolve({ id: user!.id }) },
    );
    expect(res.status).toBe(200);
    const [reloaded] = await db.select().from(schema.users).where(eq(schema.users.id, user!.id));
    expect(reloaded!.name).toBe('Daniel');
  });

  it('DELETE removes the workspace_members row (deprovision)', async () => {
    const t = await seedTokenAndWorkspace(['users:read', 'users:write']);
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'eve@x', name: 'Eve', passwordHash: 'x' })
      .returning({ id: schema.users.id });
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: t.workspaceId, userId: user!.id, role: 'editor' });

    const { DELETE } = await import('@/app/api/scim/v2/Users/[id]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/scim/v2/Users/${user!.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${t.raw}` },
      }),
      { params: Promise.resolve({ id: user!.id }) },
    );
    expect(res.status).toBe(204);

    const members = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, t.workspaceId),
          eq(schema.workspaceMembers.userId, user!.id),
        ),
      );
    expect(members).toHaveLength(0);
    // User row itself is preserved (other workspaces may still reference it):
    const users = await db.select().from(schema.users).where(eq(schema.users.id, user!.id));
    expect(users).toHaveLength(1);
  });
});
