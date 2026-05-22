import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser, type TestUser } from '../helpers/fixtures';

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
  await sql`TRUNCATE comments, db_cells, db_rows, db_properties, databases, files, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function setActor(userId: string) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId });
}

// Create a page + database + row in the given workspace; returns the row id.
async function seedRow(user: TestUser): Promise<string> {
  const page = await createPage(getDb(), {
    workspaceId: user.workspaceId,
    createdBy: user.userId,
  });
  const [db] = await getDb()
    .insert(schema.databases)
    .values({ workspaceId: user.workspaceId, pageId: page.id, createdBy: user.userId })
    .returning();
  if (!db) throw new Error('database insert failed');
  const [row] = await getDb()
    .insert(schema.dbRows)
    .values({ databaseId: db.id, createdBy: user.userId })
    .returning();
  if (!row) throw new Error('row insert failed');
  return row.id;
}

async function call(method: 'GET' | 'POST', databaseId: string, rowId: string, body?: unknown) {
  const mod = await import('@/app/api/databases/[databaseId]/rows/[rowId]/comments/route');
  const handler = mod[method] as (
    req: Request,
    ctx: { params: Promise<{ databaseId: string; rowId: string }> },
  ) => Promise<Response>;
  const res = await handler(
    new Request(`http://localhost/api/databases/${databaseId}/rows/${rowId}/comments`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ databaseId, rowId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('/api/databases/[databaseId]/rows/[rowId]/comments', () => {
  it('POST creates a row comment as editor', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const rowId = await seedRow(u);
    await setActor(u.userId);
    const r = await call('POST', 'unused', rowId, { body: 'on a row' });
    expect(r.status).toBe(201);
    expect((r.body as { targetType: string; body: string }).targetType).toBe('db_row');
    expect((r.body as { body: string }).body).toBe('on a row');
  });

  it('POST 403 for viewer', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    const rowId = await seedRow(u);
    await setActor(u.userId);
    const r = await call('POST', 'unused', rowId, { body: 'no' });
    expect(r.status).toBe(403);
  });

  it('GET lists comments for viewer+', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    const rowId = await seedRow(u);
    await setActor(u.userId);
    const r = await call('GET', 'unused', rowId);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it('GET 404 for a row in another workspace', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const other = await createTestWorkspaceWithUser(getDb());
    const rowId = await seedRow(other);
    await setActor(u.userId);
    const r = await call('GET', 'unused', rowId);
    expect(r.status).toBe(404);
  });
});
