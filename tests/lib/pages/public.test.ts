import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { getPublishedPageBySlug } from '@/lib/pages/public';
import { publishPage } from '@/lib/pages/publish';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makePublishedPage(workspaceId: string, userId: string, title = 'Roadmap') {
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId, title, createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  const { slug } = await publishPage(db, { pageId: p.id, workspaceId });
  return { page: p, slug };
}

describe('getPublishedPageBySlug', () => {
  it('returns a published, non-deleted page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { slug, page } = await makePublishedPage(u.workspaceId, u.userId);
    const found = await getPublishedPageBySlug(db, slug);
    expect(found?.id).toBe(page.id);
  });

  it('returns null for an unpublished page (slug retained)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { slug, page } = await makePublishedPage(u.workspaceId, u.userId);
    await db.update(schema.pages).set({ published: false }).where(eq(schema.pages.id, page.id));
    expect(await getPublishedPageBySlug(db, slug)).toBeNull();
  });

  it('returns null for a soft-deleted page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const { slug, page } = await makePublishedPage(u.workspaceId, u.userId);
    await db
      .update(schema.pages)
      .set({ deletedAt: new Date() })
      .where(eq(schema.pages.id, page.id));
    expect(await getPublishedPageBySlug(db, slug)).toBeNull();
  });

  it('returns null for an unknown slug', async () => {
    expect(await getPublishedPageBySlug(db, 'does-not-exist-abc123')).toBeNull();
  });
});
