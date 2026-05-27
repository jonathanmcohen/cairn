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

describe('POST /api/pages/[pageId]/move-space', () => {
  it('moves page into specified space', async () => {
    const db = getDb();
    const ts = `${Date.now()}-${Math.random()}`;
    const [u] = await db
      .insert(schema.users)
      .values({ email: `a${ts}@x.test`, passwordHash: 'h', name: 'A' })
      .returning();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'w', slug: `w-${ts}` })
      .returning();
    if (!u || !ws) throw new Error('seed');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws.id, userId: u.id, role: 'admin' });
    const [space] = await db
      .insert(schema.spaces)
      .values({ workspaceId: ws.id, name: 'X', slug: 'x' })
      .returning();
    const [page] = await db
      .insert(schema.pages)
      .values({ workspaceId: ws.id, title: 'p', createdBy: u.id, content: {} })
      .returning();
    if (!space || !page) throw new Error('seed');

    await setUser(u.id);
    const { POST } = await import('@/app/api/pages/[pageId]/move-space/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/move-space`, {
        method: 'POST',
        body: JSON.stringify({ spaceId: space.id }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);
    const [refreshed] = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(refreshed?.spaceId).toBe(space.id);
  });

  it('NULL clears the space', async () => {
    const db = getDb();
    const ts = `${Date.now()}-${Math.random()}`;
    const [u] = await db
      .insert(schema.users)
      .values({ email: `b${ts}@x.test`, passwordHash: 'h', name: 'B' })
      .returning();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'w2', slug: `w-${ts}` })
      .returning();
    if (!u || !ws) throw new Error('seed');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: ws.id, userId: u.id, role: 'admin' });
    const [space] = await db
      .insert(schema.spaces)
      .values({ workspaceId: ws.id, name: 'X', slug: 'x' })
      .returning();
    const [page] = await db
      .insert(schema.pages)
      .values({
        workspaceId: ws.id,
        spaceId: space?.id,
        title: 'p',
        createdBy: u.id,
        content: {},
      })
      .returning();
    if (!space || !page) throw new Error('seed');

    await setUser(u.id);
    const { POST } = await import('@/app/api/pages/[pageId]/move-space/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/move-space`, {
        method: 'POST',
        body: JSON.stringify({ spaceId: null }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(200);
    const [refreshed] = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.id, page.id));
    expect(refreshed?.spaceId).toBeNull();
  });

  it('rejects when caller lacks editor access on the page', async () => {
    // A workspace `viewer` cannot edit the page itself — requirePageAccess
    // returns 403/404 before move-space can touch the space.
    const db = getDb();
    const ts = `${Date.now()}-${Math.random()}`;
    const [admin] = await db
      .insert(schema.users)
      .values({ email: `a${ts}@x.test`, passwordHash: 'h', name: 'A' })
      .returning();
    const [viewer] = await db
      .insert(schema.users)
      .values({ email: `v${ts}@x.test`, passwordHash: 'h', name: 'V' })
      .returning();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'w3', slug: `w-${ts}` })
      .returning();
    if (!admin || !viewer || !ws) throw new Error('seed');
    await db.insert(schema.workspaceMembers).values([
      { workspaceId: ws.id, userId: admin.id, role: 'admin' },
      { workspaceId: ws.id, userId: viewer.id, role: 'viewer' },
    ]);
    const [space] = await db
      .insert(schema.spaces)
      .values({ workspaceId: ws.id, name: 'P', slug: 'p' })
      .returning();
    const [page] = await db
      .insert(schema.pages)
      .values({ workspaceId: ws.id, title: 'p', createdBy: admin.id, content: {} })
      .returning();
    if (!space || !page) throw new Error('seed');

    await setUser(viewer.id);
    const { POST } = await import('@/app/api/pages/[pageId]/move-space/route');
    const res = await POST(
      new Request(`http://localhost/api/pages/${page.id}/move-space`, {
        method: 'POST',
        body: JSON.stringify({ spaceId: space.id }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(res.status).toBe(403);
  });
});
