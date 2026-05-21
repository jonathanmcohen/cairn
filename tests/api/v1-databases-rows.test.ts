import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { mintKey } from '@/lib/api/keys';
import { __resetBuckets } from '@/lib/api/rate-limit';
import type { MemberRole } from '@/lib/auth/require-role';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, api_keys, databases, db_properties, db_rows, db_cells, db_views RESTART IDENTITY CASCADE`;
  __resetBuckets();
});

async function keyFor(role: MemberRole) {
  const u = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
  const { token } = await mintKey(getDb(), {
    workspaceId: u.workspaceId,
    name: 'k',
    role,
    createdBy: u.userId,
  });
  return { token, u };
}

async function seedPage(workspaceId: string, createdBy: string) {
  const [p] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId, title: 'Host', createdBy })
    .returning();
  if (!p) throw new Error('seed page failed');
  return p;
}

function call(method: string, path: string, token: string | null, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('/api/v1/databases', () => {
  it('401 without a key', async () => {
    const { POST } = await import('@/app/api/v1/databases/route');
    const res = await POST(call('POST', '/api/v1/databases', null, {}));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('editor key creates a database and lists databases', async () => {
    const { token, u } = await keyFor('editor');
    const page = await seedPage(u.workspaceId, u.userId);
    const routes = await import('@/app/api/v1/databases/route');

    const created = await routes.POST(
      call('POST', '/api/v1/databases', token, { pageId: page.id, name: 'Tasks' }),
    );
    expect(created.status).toBe(201);
    const db = (await created.json()) as { id: string; name: string };
    expect(db.name).toBe('Tasks');

    const list = await routes.GET(call('GET', '/api/v1/databases?limit=10', token));
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body.data).toHaveLength(1);
  });

  it('lists databases with a cursor', async () => {
    const { token, u } = await keyFor('editor');
    const routes = await import('@/app/api/v1/databases/route');
    for (let i = 0; i < 3; i++) {
      const page = await seedPage(u.workspaceId, u.userId);
      const c = await routes.POST(
        call('POST', '/api/v1/databases', token, { pageId: page.id, name: `D${i}` }),
      );
      expect(c.status).toBe(201);
    }
    const list = await routes.GET(call('GET', '/api/v1/databases?limit=2', token));
    const body = (await list.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body.data).toHaveLength(2);
    expect(body.nextCursor).toBeTruthy();
  });

  it('viewer key cannot create (403)', async () => {
    const { token, u } = await keyFor('viewer');
    const page = await seedPage(u.workspaceId, u.userId);
    const { POST } = await import('@/app/api/v1/databases/route');
    const res = await POST(call('POST', '/api/v1/databases', token, { pageId: page.id }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
  });

  it('malformed body → 400 validation', async () => {
    const { token } = await keyFor('editor');
    const { POST } = await import('@/app/api/v1/databases/route');
    const res = await POST(call('POST', '/api/v1/databases', token, { pageId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation');
  });

  it('cross-workspace database id returns 404', async () => {
    const { token } = await keyFor('editor');
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const page = await seedPage(other.workspaceId, other.userId);
    const [d] = await getDb()
      .insert(schema.databases)
      .values({
        workspaceId: other.workspaceId,
        pageId: page.id,
        createdBy: other.userId,
        name: 'Other',
      })
      .returning();
    if (!d) throw new Error('seed failed');
    const { GET } = await import('@/app/api/v1/databases/[databaseId]/route');
    const res = await GET(call('GET', `/api/v1/databases/${d.id}`, token), {
      params: Promise.resolve({ databaseId: d.id }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('editor can get, patch, and delete a database', async () => {
    const { token, u } = await keyFor('editor');
    const page = await seedPage(u.workspaceId, u.userId);
    const routes = await import('@/app/api/v1/databases/route');
    const created = await routes.POST(
      call('POST', '/api/v1/databases', token, { pageId: page.id, name: 'Orig' }),
    );
    const db = (await created.json()) as { id: string };

    const item = await import('@/app/api/v1/databases/[databaseId]/route');
    const got = await item.GET(call('GET', `/api/v1/databases/${db.id}`, token), {
      params: Promise.resolve({ databaseId: db.id }),
    });
    expect(got.status).toBe(200);

    const patched = await item.PATCH(
      call('PATCH', `/api/v1/databases/${db.id}`, token, { name: 'Renamed' }),
      { params: Promise.resolve({ databaseId: db.id }) },
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { name: string }).name).toBe('Renamed');

    const deleted = await item.DELETE(call('DELETE', `/api/v1/databases/${db.id}`, token), {
      params: Promise.resolve({ databaseId: db.id }),
    });
    expect(deleted.status).toBe(204);

    const gone = await item.GET(call('GET', `/api/v1/databases/${db.id}`, token), {
      params: Promise.resolve({ databaseId: db.id }),
    });
    expect(gone.status).toBe(404);
  });
});

describe('/api/v1/databases/[databaseId]/rows', () => {
  async function makeDatabase(token: string, u: { workspaceId: string; userId: string }) {
    const page = await seedPage(u.workspaceId, u.userId);
    const routes = await import('@/app/api/v1/databases/route');
    const created = await routes.POST(
      call('POST', '/api/v1/databases', token, { pageId: page.id, name: 'Tasks' }),
    );
    return (await created.json()) as { id: string };
  }

  it('editor creates a row and lists rows with a cursor', async () => {
    const { token, u } = await keyFor('editor');
    const db = await makeDatabase(token, u);
    const routes = await import('@/app/api/v1/databases/[databaseId]/rows/route');
    const ctx = { params: Promise.resolve({ databaseId: db.id }) };
    for (let i = 0; i < 3; i++) {
      const c = await routes.POST(call('POST', `/api/v1/databases/${db.id}/rows`, token, {}), ctx);
      expect(c.status).toBe(201);
    }
    const list = await routes.GET(
      call('GET', `/api/v1/databases/${db.id}/rows?limit=2`, token),
      ctx,
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body.data).toHaveLength(2);
    expect(body.nextCursor).toBeTruthy();
  });

  it('viewer key cannot create a row (403)', async () => {
    const editor = await keyFor('editor');
    const db = await makeDatabase(editor.token, editor.u);
    // a viewer key in the SAME workspace
    const { token: viewerToken } = await (async () => {
      const { token } = await mintKey(getDb(), {
        workspaceId: editor.u.workspaceId,
        name: 'v',
        role: 'viewer',
        createdBy: editor.u.userId,
      });
      return { token };
    })();
    const routes = await import('@/app/api/v1/databases/[databaseId]/rows/route');
    const res = await routes.POST(
      call('POST', `/api/v1/databases/${db.id}/rows`, viewerToken, {}),
      {
        params: Promise.resolve({ databaseId: db.id }),
      },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
  });

  it('cross-workspace database id returns 404 on rows', async () => {
    const { token } = await keyFor('editor');
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const page = await seedPage(other.workspaceId, other.userId);
    const [d] = await getDb()
      .insert(schema.databases)
      .values({
        workspaceId: other.workspaceId,
        pageId: page.id,
        createdBy: other.userId,
        name: 'Other',
      })
      .returning();
    if (!d) throw new Error('seed failed');
    const routes = await import('@/app/api/v1/databases/[databaseId]/rows/route');
    const res = await routes.GET(call('GET', `/api/v1/databases/${d.id}/rows`, token), {
      params: Promise.resolve({ databaseId: d.id }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });

  it('editor can get, patch, and delete a row; cross-workspace row 404', async () => {
    const { token, u } = await keyFor('editor');
    const db = await makeDatabase(token, u);
    const collection = await import('@/app/api/v1/databases/[databaseId]/rows/route');
    const created = await collection.POST(
      call('POST', `/api/v1/databases/${db.id}/rows`, token, {}),
      { params: Promise.resolve({ databaseId: db.id }) },
    );
    const row = (await created.json()) as { id: string };

    const item = await import('@/app/api/v1/databases/[databaseId]/rows/[rowId]/route');
    const params = { params: Promise.resolve({ databaseId: db.id, rowId: row.id }) };

    const got = await item.GET(
      call('GET', `/api/v1/databases/${db.id}/rows/${row.id}`, token),
      params,
    );
    expect(got.status).toBe(200);

    const patched = await item.PATCH(
      call('PATCH', `/api/v1/databases/${db.id}/rows/${row.id}`, token, { cells: {} }),
      params,
    );
    expect(patched.status).toBe(200);

    const deleted = await item.DELETE(
      call('DELETE', `/api/v1/databases/${db.id}/rows/${row.id}`, token),
      params,
    );
    expect(deleted.status).toBe(204);

    const gone = await item.GET(
      call('GET', `/api/v1/databases/${db.id}/rows/${row.id}`, token),
      params,
    );
    expect(gone.status).toBe(404);
  });

  it('row from another workspace returns 404', async () => {
    const { token, u } = await keyFor('editor');
    const db = await makeDatabase(token, u);
    // a row in a DIFFERENT workspace's database
    const other = await createTestWorkspaceWithUser(getDb(), { role: 'admin' });
    const page = await seedPage(other.workspaceId, other.userId);
    const [otherDb] = await getDb()
      .insert(schema.databases)
      .values({
        workspaceId: other.workspaceId,
        pageId: page.id,
        createdBy: other.userId,
        name: 'Other',
      })
      .returning();
    if (!otherDb) throw new Error('seed failed');
    const [otherRow] = await getDb()
      .insert(schema.dbRows)
      .values({ databaseId: otherDb.id, createdBy: other.userId })
      .returning();
    if (!otherRow) throw new Error('seed failed');
    const item = await import('@/app/api/v1/databases/[databaseId]/rows/[rowId]/route');
    const res = await item.GET(
      call('GET', `/api/v1/databases/${db.id}/rows/${otherRow.id}`, token),
      { params: Promise.resolve({ databaseId: db.id, rowId: otherRow.id }) },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });
});
