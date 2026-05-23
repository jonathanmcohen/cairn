import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { publishPage, slugify, unpublishPage } from '@/lib/pages/publish';
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

async function makePage(workspaceId: string, userId: string, title: string) {
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId, title, createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

describe('slugify', () => {
  it('lowercases, replaces non-alphanumerics with hyphens, trims', () => {
    expect(slugify('My Great Roadmap!')).toBe('my-great-roadmap');
    expect(slugify('  Spaces   &  Stuff  ')).toBe('spaces-stuff');
  });
  it('falls back to "page" for an empty slug', () => {
    expect(slugify('***')).toBe('page');
    expect(slugify('')).toBe('page');
  });
});

describe('publishPage', () => {
  it('sets published and mints a slug shaped <slug>-<6hex>', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await makePage(u.workspaceId, u.userId, 'Roadmap');
    const { slug } = await publishPage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    expect(slug).toMatch(/^roadmap-[0-9a-f]{6}$/);
    const [row] = await db.select().from(schema.pages).where(eq(schema.pages.id, page.id));
    expect(row?.published).toBe(true);
    expect(row?.publicSlug).toBe(slug);
  });

  it('re-publish keeps the same slug', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await makePage(u.workspaceId, u.userId, 'Roadmap');
    const first = await publishPage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    await unpublishPage(db, { pageId: page.id, workspaceId: u.workspaceId, actorUserId: u.userId });
    const second = await publishPage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    expect(second.slug).toBe(first.slug);
  });

  it('rejects a page in another workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const page = await makePage(a.workspaceId, a.userId, 'Secret');
    await expect(
      publishPage(db, { pageId: page.id, workspaceId: b.workspaceId, actorUserId: b.userId }),
    ).rejects.toThrow();
  });
});

describe('unpublishPage', () => {
  it('sets published false but retains the slug', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await makePage(u.workspaceId, u.userId, 'Roadmap');
    const { slug } = await publishPage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
    });
    await unpublishPage(db, { pageId: page.id, workspaceId: u.workspaceId, actorUserId: u.userId });
    const [row] = await db.select().from(schema.pages).where(eq(schema.pages.id, page.id));
    expect(row?.published).toBe(false);
    expect(row?.publicSlug).toBe(slug);
  });

  it('rejects a page in another workspace', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const page = await makePage(a.workspaceId, a.userId, 'Secret');
    await expect(
      unpublishPage(db, { pageId: page.id, workspaceId: b.workspaceId, actorUserId: b.userId }),
    ).rejects.toThrow();
  });
});
