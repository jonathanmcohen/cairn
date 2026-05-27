import { eq } from 'drizzle-orm';
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
  const [editor] = await db
    .insert(schema.users)
    .values({ email: `e${ts}@x.test`, passwordHash: 'h', name: 'E' })
    .returning();
  if (!admin || !editor) throw new Error('user');
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: 'w', slug: `w-${ts}` })
    .returning();
  if (!ws) throw new Error('ws');
  await db.insert(schema.workspaceMembers).values([
    { workspaceId: ws.id, userId: admin.id, role: 'admin' },
    { workspaceId: ws.id, userId: editor.id, role: 'editor' },
  ]);
  return { admin, editor, ws };
}

describe('POST /api/spaces', () => {
  it('admin creates a space', async () => {
    const { admin } = await seed();
    await setUser(admin.id);
    const { POST } = await import('@/app/api/spaces/route');
    const res = await POST(
      new Request('http://localhost/api/spaces', {
        method: 'POST',
        body: JSON.stringify({ name: 'Engineering', slug: 'eng' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; slug: string };
    expect(body.slug).toBe('eng');
  });

  it('editor cannot create - 403', async () => {
    const { editor } = await seed();
    await setUser(editor.id);
    const { POST } = await import('@/app/api/spaces/route');
    const res = await POST(
      new Request('http://localhost/api/spaces', {
        method: 'POST',
        body: JSON.stringify({ name: 'X', slug: 'x' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('duplicate slug per workspace - 409', async () => {
    const { admin } = await seed();
    await setUser(admin.id);
    const { POST } = await import('@/app/api/spaces/route');
    await POST(
      new Request('http://localhost/api/spaces', {
        method: 'POST',
        body: JSON.stringify({ name: 'A', slug: 'eng' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res2 = await POST(
      new Request('http://localhost/api/spaces', {
        method: 'POST',
        body: JSON.stringify({ name: 'B', slug: 'eng' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res2.status).toBe(409);
  });
});

describe('GET /api/spaces', () => {
  it('returns visible spaces for the caller', async () => {
    const { admin, ws } = await seed();
    const db = getDb();
    await db.insert(schema.spaces).values({ workspaceId: ws.id, name: 'X', slug: 'x' });
    await setUser(admin.id);
    const { GET } = await import('@/app/api/spaces/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { spaces: { slug: string }[] };
    expect(body.spaces.map((s) => s.slug)).toContain('x');
  });
});

describe('DELETE /api/spaces/[spaceId]', () => {
  it('sets affected pages.space_id to NULL', async () => {
    const { admin, ws } = await seed();
    const db = getDb();
    const [space] = await db
      .insert(schema.spaces)
      .values({ workspaceId: ws.id, name: 'X', slug: 'x' })
      .returning();
    if (!space) throw new Error('space');
    const [page] = await db
      .insert(schema.pages)
      .values({
        workspaceId: ws.id,
        spaceId: space.id,
        title: 'p',
        createdBy: admin.id,
        content: {},
      })
      .returning();
    if (!page) throw new Error('page');
    await setUser(admin.id);
    const { DELETE } = await import('@/app/api/spaces/[spaceId]/route');
    const res = await DELETE(new Request(`http://localhost/api/spaces/${space.id}`, { method: 'DELETE' }), {
      params: Promise.resolve({ spaceId: space.id }),
    });
    expect(res.status).toBe(204);
    const [refreshed] = await db.select().from(schema.pages).where(eq(schema.pages.id, page.id));
    expect(refreshed?.spaceId).toBeNull();
  });

  it('cross-workspace space → 404 (existence-hiding)', async () => {
    const { admin } = await seed();
    const db = getDb();
    const ts = `${Date.now()}-${Math.random()}`;
    const [otherUser] = await db
      .insert(schema.users)
      .values({ email: `o${ts}@x.test`, passwordHash: 'h', name: 'O' })
      .returning();
    const [otherWs] = await db
      .insert(schema.workspaces)
      .values({ name: 'other', slug: `o-${ts}` })
      .returning();
    if (!otherUser || !otherWs) throw new Error('seed');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: otherWs.id, userId: otherUser.id, role: 'owner' });
    const [foreignSpace] = await db
      .insert(schema.spaces)
      .values({ workspaceId: otherWs.id, name: 'F', slug: 'f' })
      .returning();
    if (!foreignSpace) throw new Error('space');
    await setUser(admin.id);
    const { DELETE } = await import('@/app/api/spaces/[spaceId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/spaces/${foreignSpace.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ spaceId: foreignSpace.id }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/spaces/[spaceId]', () => {
  it('updates name + icon', async () => {
    const { admin, ws } = await seed();
    const db = getDb();
    const [space] = await db
      .insert(schema.spaces)
      .values({ workspaceId: ws.id, name: 'Old', slug: 'old' })
      .returning();
    if (!space) throw new Error('space');
    await setUser(admin.id);
    const { PATCH } = await import('@/app/api/spaces/[spaceId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/spaces/${space.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New', icon: '📁' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ spaceId: space.id }) },
    );
    expect(res.status).toBe(200);
    const [refreshed] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, space.id));
    expect(refreshed?.name).toBe('New');
    expect(refreshed?.icon).toBe('📁');
  });
});
