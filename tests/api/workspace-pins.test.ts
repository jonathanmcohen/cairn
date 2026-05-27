import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../helpers/db';

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
  await sql`TRUNCATE workspace_pins, audit_log, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
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
  const [p1] = await db
    .insert(schema.pages)
    .values({ workspaceId: ws.id, title: 'A', createdBy: admin.id, content: {} })
    .returning();
  const [p2] = await db
    .insert(schema.pages)
    .values({ workspaceId: ws.id, title: 'B', createdBy: admin.id, content: {} })
    .returning();
  if (!p1 || !p2) throw new Error('page');
  return { admin, editor, ws, p1, p2 };
}

describe('/api/workspace/pins', () => {
  it('GET returns pins for any member (viewer+)', async () => {
    const { editor, admin, ws, p1 } = await seed();
    await getDb()
      .insert(schema.workspacePins)
      .values({ workspaceId: ws.id, pageId: p1.id, position: 0, pinnedBy: admin.id });
    await setUser(editor.id);
    const { GET } = await import('@/app/api/workspace/pins/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pins: Array<{ pageId: string }> };
    expect(body.pins).toHaveLength(1);
    expect(body.pins[0]?.pageId).toBe(p1.id);
  });

  it('POST rejects editor (403)', async () => {
    const { editor, p1 } = await seed();
    await setUser(editor.id);
    const { POST } = await import('@/app/api/workspace/pins/route');
    const res = await POST(
      new Request('http://localhost/api/workspace/pins', {
        method: 'POST',
        body: JSON.stringify({ pageId: p1.id }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('POST admin adds pin', async () => {
    const { admin, ws, p1 } = await seed();
    await setUser(admin.id);
    const { POST } = await import('@/app/api/workspace/pins/route');
    const res = await POST(
      new Request('http://localhost/api/workspace/pins', {
        method: 'POST',
        body: JSON.stringify({ pageId: p1.id }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.status).toBe(201);
    const rows = await getDb()
      .select()
      .from(schema.workspacePins)
      .where(eq(schema.workspacePins.workspaceId, ws.id));
    expect(rows).toHaveLength(1);
  });

  it('PUT reorders positions', async () => {
    const { admin, ws, p1, p2 } = await seed();
    await getDb()
      .insert(schema.workspacePins)
      .values([
        { workspaceId: ws.id, pageId: p1.id, position: 0, pinnedBy: admin.id },
        { workspaceId: ws.id, pageId: p2.id, position: 1, pinnedBy: admin.id },
      ]);
    await setUser(admin.id);
    const { PUT } = await import('@/app/api/workspace/pins/route');
    const res = await PUT(
      new Request('http://localhost/api/workspace/pins', {
        method: 'PUT',
        body: JSON.stringify({ orderedPageIds: [p2.id, p1.id] }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.status).toBe(204);
    const rows = await getDb()
      .select()
      .from(schema.workspacePins)
      .where(eq(schema.workspacePins.workspaceId, ws.id));
    const map = new Map(rows.map((r) => [r.pageId, r.position]));
    expect(map.get(p2.id)).toBe(0);
    expect(map.get(p1.id)).toBe(1);
  });

  it('DELETE removes pin', async () => {
    const { admin, ws, p1 } = await seed();
    await getDb()
      .insert(schema.workspacePins)
      .values({ workspaceId: ws.id, pageId: p1.id, position: 0, pinnedBy: admin.id });
    await setUser(admin.id);
    const { DELETE } = await import('@/app/api/workspace/pins/[pageId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/workspace/pins/${p1.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ pageId: p1.id }) },
    );
    expect(res.status).toBe(204);
    const rows = await getDb()
      .select()
      .from(schema.workspacePins)
      .where(eq(schema.workspacePins.workspaceId, ws.id));
    expect(rows).toHaveLength(0);
  });

  it('cross-workspace pageId on POST returns 404 (existence-hiding)', async () => {
    const { admin } = await seed();
    const db = getDb();
    const ts = `${Date.now()}-${Math.random()}`;
    const [otherWs] = await db
      .insert(schema.workspaces)
      .values({ name: 'o', slug: `o-${ts}` })
      .returning();
    if (!otherWs) throw new Error('ws');
    await db.insert(schema.workspaceMembers).values({
      workspaceId: otherWs.id,
      userId: admin.id,
      role: 'admin',
    });
    const [otherPage] = await db
      .insert(schema.pages)
      .values({ workspaceId: otherWs.id, title: 'x', createdBy: admin.id, content: {} })
      .returning();
    if (!otherPage) throw new Error('page');
    await setUser(admin.id);
    const { POST } = await import('@/app/api/workspace/pins/route');
    const res = await POST(
      new Request('http://localhost/api/workspace/pins', {
        method: 'POST',
        body: JSON.stringify({ pageId: otherPage.id }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('GET rejects unauthenticated (401)', async () => {
    await seed();
    await setUser(null);
    const { GET } = await import('@/app/api/workspace/pins/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
