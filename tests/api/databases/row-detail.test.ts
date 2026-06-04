import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createDatabase } from '@/lib/databases/create';
import { createProperty } from '@/lib/databases/properties';
import { createRow } from '@/lib/databases/rows';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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
  await sql`TRUNCATE databases, pages, workspaces, users, workspace_members, sessions, accounts RESTART IDENTITY CASCADE`;
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

async function asUser(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  const u = await createTestWorkspaceWithUser(getDb(), { role });
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set({ userId: u.userId });
  return u;
}

async function makeDatabase(workspaceId: string, userId: string) {
  const page = await createPage(getDb(), { workspaceId, createdBy: userId });
  return createDatabase(getDb(), { workspaceId, pageId: page.id, createdBy: userId, name: 'DB' });
}

describe('row-detail GET + body PATCH route', () => {
  it('GET returns { row, cells, body }', async () => {
    const u = await asUser('editor');
    const d = await makeDatabase(u.workspaceId, u.userId);
    const prop = await createProperty(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Title',
      type: 'text',
    });
    const row = await createRow(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 'hello' },
    });
    const { GET } = await import('@/app/api/databases/[databaseId]/rows/[rowId]/route');
    const res = await GET(new Request(`http://localhost/api/databases/${d.id}/rows/${row.id}`), {
      params: Promise.resolve({ databaseId: d.id, rowId: row.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      row: { id: string };
      cells: Record<string, unknown>;
      body: unknown;
    };
    expect(body.row.id).toBe(row.id);
    expect(body.cells[prop.id]).toBe('hello');
    expect(body.body).toBeNull();
  });

  it('PATCH with body only → 204 and persists', async () => {
    const u = await asUser('editor');
    const d = await makeDatabase(u.workspaceId, u.userId);
    const row = await createRow(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    const doc = { type: 'doc', content: [] };
    const { GET, PATCH } = await import('@/app/api/databases/[databaseId]/rows/[rowId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/databases/${d.id}/rows/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: doc }),
      }),
      { params: Promise.resolve({ databaseId: d.id, rowId: row.id }) },
    );
    expect(res.status).toBe(204);
    const got = await GET(new Request(`http://localhost/api/databases/${d.id}/rows/${row.id}`), {
      params: Promise.resolve({ databaseId: d.id, rowId: row.id }),
    });
    expect(((await got.json()) as { body: unknown }).body).toEqual(doc);
  });

  it('PATCH with both cells and body updates both', async () => {
    const u = await asUser('editor');
    const d = await makeDatabase(u.workspaceId, u.userId);
    const prop = await createProperty(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Title',
      type: 'text',
    });
    const row = await createRow(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
    });
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    const { GET, PATCH } = await import('@/app/api/databases/[databaseId]/rows/[rowId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/databases/${d.id}/rows/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cells: { [prop.id]: 'both' }, body: doc }),
      }),
      { params: Promise.resolve({ databaseId: d.id, rowId: row.id }) },
    );
    expect(res.status).toBe(204);
    const got = await GET(new Request(`http://localhost/api/databases/${d.id}/rows/${row.id}`), {
      params: Promise.resolve({ databaseId: d.id, rowId: row.id }),
    });
    const gotBody = (await got.json()) as { cells: Record<string, unknown>; body: unknown };
    expect(gotBody.cells[prop.id]).toBe('both');
    expect(gotBody.body).toEqual(doc);
  });

  it('GET a cross-workspace row → 404', async () => {
    const owner = await createTestWorkspaceWithUser(getDb());
    const otherDb = await makeDatabase(owner.workspaceId, owner.userId);
    const otherRow = await createRow(getDb(), {
      databaseId: otherDb.id,
      workspaceId: owner.workspaceId,
      createdBy: owner.userId,
    });
    // Switch the active session to a DIFFERENT workspace's user.
    const u = await asUser('editor');
    const { GET } = await import('@/app/api/databases/[databaseId]/rows/[rowId]/route');
    const res = await GET(
      new Request(`http://localhost/api/databases/${otherDb.id}/rows/${otherRow.id}`),
      { params: Promise.resolve({ databaseId: otherDb.id, rowId: otherRow.id }) },
    );
    expect(res.status).toBe(404);
    void u;
  });
});
