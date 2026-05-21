import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { createDatabase } from '@/lib/databases/create';
import { createProperty } from '@/lib/databases/properties';
import { createRow } from '@/lib/databases/rows';
import { createPage } from '@/lib/pages/create';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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

async function getRows(databaseId: string, filters: unknown[], sorts: unknown[] = []) {
  const { GET } = await import('@/app/api/databases/[databaseId]/rows/route');
  const qs = `filters=${encodeURIComponent(JSON.stringify(filters))}&sorts=${encodeURIComponent(
    JSON.stringify(sorts),
  )}`;
  const res = await GET(new Request(`http://localhost/api/databases/${databaseId}/rows?${qs}`), {
    params: Promise.resolve({ databaseId }),
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      rows: Array<{ row: { id: string }; cells: Record<string, unknown> }>;
    },
  };
}

describe('database properties/rows/views API routes', () => {
  it('POST property as editor → 201', async () => {
    const u = await asUser('editor');
    const d = await makeDatabase(u.workspaceId, u.userId);
    const { POST } = await import('@/app/api/databases/[databaseId]/properties/route');
    const res = await POST(
      new Request(`http://localhost/api/databases/${d.id}/properties`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Priority', type: 'number' }),
      }),
      { params: Promise.resolve({ databaseId: d.id }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string; type: string };
    expect(body.name).toBe('Priority');
    expect(body.type).toBe('number');
  });

  it('POST property as viewer → 403', async () => {
    const u = await asUser('viewer');
    const owner = await createTestWorkspaceWithUser(getDb());
    const d = await makeDatabase(u.workspaceId, owner.userId);
    const { POST } = await import('@/app/api/databases/[databaseId]/properties/route');
    const res = await POST(
      new Request(`http://localhost/api/databases/${d.id}/properties`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'X', type: 'text' }),
      }),
      { params: Promise.resolve({ databaseId: d.id }) },
    );
    expect(res.status).toBe(403);
  });

  it('PATCH property renames', async () => {
    const u = await asUser('editor');
    const d = await makeDatabase(u.workspaceId, u.userId);
    const prop = await createProperty(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Old',
      type: 'text',
    });
    const { PATCH } = await import('@/app/api/databases/[databaseId]/properties/[propId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/databases/${d.id}/properties/${prop.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: Promise.resolve({ databaseId: d.id, propId: prop.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('New');
  });

  it('DELETE property → 204', async () => {
    const u = await asUser('editor');
    const d = await makeDatabase(u.workspaceId, u.userId);
    const prop = await createProperty(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Tmp',
      type: 'text',
    });
    const { DELETE } = await import('@/app/api/databases/[databaseId]/properties/[propId]/route');
    const res = await DELETE(
      new Request(`http://localhost/api/databases/${d.id}/properties/${prop.id}`),
      { params: Promise.resolve({ databaseId: d.id, propId: prop.id }) },
    );
    expect(res.status).toBe(204);
  });

  it('POST row with cells → 201', async () => {
    const u = await asUser('editor');
    const d = await makeDatabase(u.workspaceId, u.userId);
    const prop = await createProperty(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Title',
      type: 'text',
    });
    const { POST } = await import('@/app/api/databases/[databaseId]/rows/route');
    const res = await POST(
      new Request(`http://localhost/api/databases/${d.id}/rows`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cells: { [prop.id]: 'hello' } }),
      }),
      { params: Promise.resolve({ databaseId: d.id }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBeTruthy();
  });

  it('GET rows with a filter query returns filtered subset', async () => {
    const u = await asUser('editor');
    const d = await makeDatabase(u.workspaceId, u.userId);
    const prop = await createProperty(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Status',
      type: 'text',
    });
    await createRow(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 'done' },
    });
    await createRow(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 'todo' },
    });
    const { status, body } = await getRows(d.id, [
      { propertyId: prop.id, op: 'eq', value: 'done' },
    ]);
    expect(status).toBe(200);
    expect(body.rows.length).toBe(1);
    expect(body.rows[0]?.cells[prop.id]).toBe('done');
  });

  it('GET rows with a sort query returns ordered', async () => {
    const u = await asUser('editor');
    const d = await makeDatabase(u.workspaceId, u.userId);
    const prop = await createProperty(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      name: 'Rank',
      type: 'number',
    });
    await createRow(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 3 },
    });
    await createRow(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 1 },
    });
    await createRow(getDb(), {
      databaseId: d.id,
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      cells: { [prop.id]: 2 },
    });
    const { status, body } = await getRows(d.id, [], [{ propertyId: prop.id, direction: 'asc' }]);
    expect(status).toBe(200);
    expect(body.rows.map((r) => r.cells[prop.id])).toEqual([1, 2, 3]);
  });

  it('PATCH row cells updates', async () => {
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
      cells: { [prop.id]: 'before' },
    });
    const { PATCH } = await import('@/app/api/databases/[databaseId]/rows/[rowId]/route');
    const res = await PATCH(
      new Request(`http://localhost/api/databases/${d.id}/rows/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cells: { [prop.id]: 'after' } }),
      }),
      { params: Promise.resolve({ databaseId: d.id, rowId: row.id }) },
    );
    expect(res.status).toBe(204);
    const { body } = await getRows(d.id, []);
    expect(body.rows[0]?.cells[prop.id]).toBe('after');
  });

  it('DELETE row archives and excludes from subsequent GET', async () => {
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
      cells: { [prop.id]: 'gone' },
    });
    const { DELETE } = await import('@/app/api/databases/[databaseId]/rows/[rowId]/route');
    const res = await DELETE(new Request(`http://localhost/api/databases/${d.id}/rows/${row.id}`), {
      params: Promise.resolve({ databaseId: d.id, rowId: row.id }),
    });
    expect(res.status).toBe(204);
    const { body } = await getRows(d.id, []);
    expect(body.rows.length).toBe(0);
  });

  it('POST view (table) → 201; POST kanban without groupBy → 400', async () => {
    const u = await asUser('editor');
    const d = await makeDatabase(u.workspaceId, u.userId);
    const { POST } = await import('@/app/api/databases/[databaseId]/views/route');
    const ok = await POST(
      new Request(`http://localhost/api/databases/${d.id}/views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'table', name: 'My table' }),
      }),
      { params: Promise.resolve({ databaseId: d.id }) },
    );
    expect(ok.status).toBe(201);

    const bad = await POST(
      new Request(`http://localhost/api/databases/${d.id}/views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'kanban', name: 'Board' }),
      }),
      { params: Promise.resolve({ databaseId: d.id }) },
    );
    expect(bad.status).toBe(400);
  });

  it('PATCH view renames; DELETE view → 204', async () => {
    const u = await asUser('editor');
    const d = await makeDatabase(u.workspaceId, u.userId);
    const { POST } = await import('@/app/api/databases/[databaseId]/views/route');
    const created = await POST(
      new Request(`http://localhost/api/databases/${d.id}/views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'table', name: 'V1' }),
      }),
      { params: Promise.resolve({ databaseId: d.id }) },
    );
    const view = (await created.json()) as { id: string };

    const { PATCH, DELETE } = await import('@/app/api/databases/[databaseId]/views/[viewId]/route');
    const patched = await PATCH(
      new Request(`http://localhost/api/databases/${d.id}/views/${view.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'V2' }),
      }),
      { params: Promise.resolve({ databaseId: d.id, viewId: view.id }) },
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { name: string }).name).toBe('V2');

    const del = await DELETE(
      new Request(`http://localhost/api/databases/${d.id}/views/${view.id}`),
      { params: Promise.resolve({ databaseId: d.id, viewId: view.id }) },
    );
    expect(del.status).toBe(204);
  });
});
