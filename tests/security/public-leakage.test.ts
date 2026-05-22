import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDatabase } from '@/lib/databases/create';
import { getPublishedPageBySlug } from '@/lib/pages/public';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, databases, db_properties, db_views, db_rows, db_cells RESTART IDENTITY CASCADE`;
});

async function makePage(published: boolean, slug: string, deleted = false) {
  const ws = await createTestWorkspaceWithUser(db);
  const [p] = await db
    .insert(schema.pages)
    .values({
      workspaceId: ws.workspaceId,
      title: 'DRAFT-SECRET',
      createdBy: ws.userId,
      published,
      publicSlug: slug,
      ...(deleted ? { deletedAt: new Date() } : {}),
    })
    .returning();
  if (!p) throw new Error('seed failed');
  return { page: p, ws };
}

describe('public /p/<slug> leakage gate', () => {
  it('unpublished slug → null (no draft content leaked)', async () => {
    await makePage(false, 'draft-1');
    expect(await getPublishedPageBySlug(db, 'draft-1')).toBeNull();
  });

  it('deleted slug → null', async () => {
    await makePage(true, 'gone-1', true);
    expect(await getPublishedPageBySlug(db, 'gone-1')).toBeNull();
  });

  it('unknown slug → null', async () => {
    expect(await getPublishedPageBySlug(db, 'does-not-exist')).toBeNull();
  });

  it('published, non-deleted slug → resolves', async () => {
    const { page } = await makePage(true, 'live-1');
    const got = await getPublishedPageBySlug(db, 'live-1');
    expect(got?.id).toBe(page.id);
  });
});

describe('embedded public database is gated on host-page publication', () => {
  async function callPublicDb(databaseId: string) {
    const route = await import('@/app/api/public/databases/[databaseId]/route');
    return route.GET(new Request(`http://t/api/public/databases/${databaseId}`), {
      params: Promise.resolve({ databaseId }),
    });
  }

  it('readable while host page is published → 200', async () => {
    const { page, ws } = await makePage(true, 'db-host-1');
    const dbase = await createDatabase(db, {
      workspaceId: ws.workspaceId,
      pageId: page.id,
      createdBy: ws.userId,
    });
    const res = await callPublicDb(dbase.id);
    expect(res.status).toBe(200);
  });

  it('404 once host page is unpublished (no leak after unpublish)', async () => {
    const { page, ws } = await makePage(true, 'db-host-2');
    const dbase = await createDatabase(db, {
      workspaceId: ws.workspaceId,
      pageId: page.id,
      createdBy: ws.userId,
    });
    await db.update(schema.pages).set({ published: false }).where(eq(schema.pages.id, page.id));
    const res = await callPublicDb(dbase.id);
    expect(res.status).toBe(404);
  });

  it('404 once host page is soft-deleted', async () => {
    const { page, ws } = await makePage(true, 'db-host-3');
    const dbase = await createDatabase(db, {
      workspaceId: ws.workspaceId,
      pageId: page.id,
      createdBy: ws.userId,
    });
    await db
      .update(schema.pages)
      .set({ deletedAt: new Date() })
      .where(eq(schema.pages.id, page.id));
    const res = await callPublicDb(dbase.id);
    expect(res.status).toBe(404);
  });
});
