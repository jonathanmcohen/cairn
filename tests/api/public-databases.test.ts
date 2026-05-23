import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { createRow } from '@/lib/databases/rows';
import { publishPage } from '@/lib/pages/publish';
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
  await sql`TRUNCATE pages, workspaces, users, workspace_members, databases, db_properties, db_rows, db_cells, db_views RESTART IDENTITY CASCADE`;
});

// Create a page (optionally published) with a database that has one row.
async function setup(opts: { published: boolean }) {
  const u = await createTestWorkspaceWithUser(getDb());
  const [page] = await getDb()
    .insert(schema.pages)
    .values({ workspaceId: u.workspaceId, title: 'Has DB', createdBy: u.userId })
    .returning();
  if (!page) throw new Error('page insert failed');
  const database = await createDatabase(getDb(), {
    workspaceId: u.workspaceId,
    pageId: page.id,
    createdBy: u.userId,
    name: 'Tasks',
  });
  await createRow(getDb(), {
    databaseId: database.id,
    workspaceId: u.workspaceId,
    createdBy: u.userId,
  });
  if (opts.published) {
    await publishPage(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
  }
  return { databaseId: database.id };
}

async function call(databaseId: string) {
  const { GET } = await import('@/app/api/public/databases/[databaseId]/route');
  const res = await GET(new Request(`http://localhost/api/public/databases/${databaseId}`), {
    params: Promise.resolve({ databaseId }),
  });
  return { status: res.status, body: await res.json() };
}

describe('GET /api/public/databases/[databaseId]', () => {
  it('returns meta + rows when its page is published', async () => {
    const { databaseId } = await setup({ published: true });
    const r = await call(databaseId);
    expect(r.status).toBe(200);
    const body = r.body as { database: { id: string }; rows: unknown[] };
    expect(body.database.id).toBe(databaseId);
    expect(body.rows).toHaveLength(1);
  });

  it('404s when its page is not published', async () => {
    const { databaseId } = await setup({ published: false });
    const r = await call(databaseId);
    expect(r.status).toBe(404);
  });

  it('404s for an unknown database id', async () => {
    const r = await call('00000000-0000-0000-0000-000000000000');
    expect(r.status).toBe(404);
  });
});
