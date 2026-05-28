import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE audit_log, space_members, spaces, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

async function seed() {
  const db = getDb();
  const ts = `${Date.now()}-${Math.random()}`;
  const [admin] = await db
    .insert(schema.users)
    .values({ email: `a${ts}@x.test`, passwordHash: 'h', name: 'A' })
    .returning();
  const [member] = await db
    .insert(schema.users)
    .values({ email: `m${ts}@x.test`, passwordHash: 'h', name: 'M' })
    .returning();
  if (!admin || !member) throw new Error('user');
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'w', slug: `w-${ts}` })
    .returning();
  if (!ws) throw new Error('ws');
  await db.insert(schema.workspaceMembers).values([
    { workspaceId: ws.id, userId: admin.id, role: 'admin' },
    { workspaceId: ws.id, userId: member.id, role: 'editor' },
  ]);
  const [space] = await db
    .insert(schema.spaces)
    .values({ workspaceId: ws.id, name: 'X', slug: 'x' })
    .returning();
  if (!space) throw new Error('space');
  return { admin, member, ws, space };
}

describe('space members route', () => {
  it('POST adds a member as editor', async () => {
    const { admin, member, space } = await seed();
    await setUser(admin.id);
    const { POST } = await import('@/app/api/spaces/[spaceId]/members/route');
    const res = await POST(
      new Request(`http://localhost/api/spaces/${space.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: member.id, role: 'editor' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ spaceId: space.id }) },
    );
    expect(res.status).toBe(201);
    const [row] = await getDb()
      .select()
      .from(schema.spaceMembers)
      .where(
        and(eq(schema.spaceMembers.spaceId, space.id), eq(schema.spaceMembers.userId, member.id)),
      );
    expect(row?.role).toBe('editor');
  });

  it('POST upserts an existing member to a new role', async () => {
    const { admin, member, space } = await seed();
    await getDb()
      .insert(schema.spaceMembers)
      .values({ spaceId: space.id, userId: member.id, role: 'viewer' });
    await setUser(admin.id);
    const { POST } = await import('@/app/api/spaces/[spaceId]/members/route');
    const res = await POST(
      new Request(`http://localhost/api/spaces/${space.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: member.id, role: 'admin' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ spaceId: space.id }) },
    );
    expect(res.status).toBe(201);
    const [row] = await getDb()
      .select()
      .from(schema.spaceMembers)
      .where(
        and(eq(schema.spaceMembers.spaceId, space.id), eq(schema.spaceMembers.userId, member.id)),
      );
    expect(row?.role).toBe('admin');
  });

  it('DELETE removes a member', async () => {
    const { admin, member, space } = await seed();
    await getDb()
      .insert(schema.spaceMembers)
      .values({ spaceId: space.id, userId: member.id, role: 'editor' });
    await setUser(admin.id);
    const { DELETE } = await import('@/app/api/spaces/[spaceId]/members/route');
    const res = await DELETE(
      new Request(`http://localhost/api/spaces/${space.id}/members?userId=${member.id}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ spaceId: space.id }) },
    );
    expect(res.status).toBe(204);
    const rows = await getDb()
      .select()
      .from(schema.spaceMembers)
      .where(
        and(eq(schema.spaceMembers.spaceId, space.id), eq(schema.spaceMembers.userId, member.id)),
      );
    expect(rows).toHaveLength(0);
  });

  it('GET returns members of the space', async () => {
    const { admin, member, space } = await seed();
    await getDb()
      .insert(schema.spaceMembers)
      .values({ spaceId: space.id, userId: member.id, role: 'editor' });
    await setUser(admin.id);
    const { GET } = await import('@/app/api/spaces/[spaceId]/members/route');
    const res = await GET(new Request(`http://localhost/api/spaces/${space.id}/members`), {
      params: Promise.resolve({ spaceId: space.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: { userId: string; role: string }[] };
    expect(body.members.map((m) => m.userId)).toContain(member.id);
  });

  it('non-admin caller is rejected with 403', async () => {
    const { member, space } = await seed();
    await setUser(member.id);
    const { POST } = await import('@/app/api/spaces/[spaceId]/members/route');
    const res = await POST(
      new Request(`http://localhost/api/spaces/${space.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: member.id, role: 'editor' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ spaceId: space.id }) },
    );
    expect(res.status).toBe(403);
  });
});
