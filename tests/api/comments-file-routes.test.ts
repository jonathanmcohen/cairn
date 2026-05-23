import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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

// Insert a page-less file in the given workspace; returns its id.
async function makeFile(user: TestUser): Promise<string> {
  const [file] = await getDb()
    .insert(schema.files)
    .values({
      workspaceId: user.workspaceId,
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      path: 'p/doc.pdf',
      uploadedBy: user.userId,
    })
    .returning();
  if (!file) throw new Error('file insert failed');
  return file.id;
}

async function call(method: 'GET' | 'POST', fileId: string, body?: unknown) {
  const mod = await import('@/app/api/files/[fileId]/comments/route');
  const handler = mod[method] as (
    req: Request,
    ctx: { params: Promise<{ fileId: string }> },
  ) => Promise<Response>;
  const res = await handler(
    new Request(`http://localhost/api/files/${fileId}/comments`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ fileId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('/api/files/[fileId]/comments', () => {
  it('POST creates a page-less file comment as editor', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const fileId = await makeFile(u);
    await setActor(u.userId);
    const r = await call('POST', fileId, { body: 'on a file' });
    expect(r.status).toBe(201);
    expect((r.body as { targetType: string; body: string }).targetType).toBe('file');
    expect((r.body as { body: string }).body).toBe('on a file');
  });

  it('POST 403 for viewer', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    const fileId = await makeFile(u);
    await setActor(u.userId);
    const r = await call('POST', fileId, { body: 'no' });
    expect(r.status).toBe(403);
  });

  it('GET lists comments for viewer+', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'viewer' });
    const fileId = await makeFile(u);
    await setActor(u.userId);
    const r = await call('GET', fileId);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it('GET 404 for a file in another workspace', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'owner' });
    const other = await createTestWorkspaceWithUser(getDb());
    const fileId = await makeFile(other);
    await setActor(u.userId);
    const r = await call('GET', fileId);
    expect(r.status).toBe(404);
  });
});
