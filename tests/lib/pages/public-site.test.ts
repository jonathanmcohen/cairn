import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { getPublicSitePages, setPublicSite } from '@/lib/pages/public-site';
import { publishPage } from '@/lib/pages/publish';
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

describe('setPublicSite', () => {
  it('sets slug + enabled, and rejects a duplicate slug across workspaces', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    await setPublicSite(db, { workspaceId: a.workspaceId, slug: 'team', enabled: true });
    await expect(
      setPublicSite(db, { workspaceId: b.workspaceId, slug: 'team', enabled: true }),
    ).rejects.toThrow();
  });
});

describe('getPublicSitePages', () => {
  it('returns null for a disabled or unknown site', async () => {
    const a = await createTestWorkspaceWithUser(db);
    await setPublicSite(db, { workspaceId: a.workspaceId, slug: 'team', enabled: false });
    expect(await getPublicSitePages(db, 'team')).toBeNull();
    expect(await getPublicSitePages(db, 'nope')).toBeNull();
  });

  it('lists only published, non-deleted pages of an enabled site', async () => {
    const a = await createTestWorkspaceWithUser(db);
    await setPublicSite(db, { workspaceId: a.workspaceId, slug: 'team', enabled: true });

    const [pub] = await db
      .insert(schema.pages)
      .values({ workspaceId: a.workspaceId, title: 'Published', createdBy: a.userId })
      .returning();
    await publishPage(db, {
      pageId: pub!.id,
      workspaceId: a.workspaceId,
      actorUserId: a.userId,
    });
    await db
      .insert(schema.pages)
      .values({ workspaceId: a.workspaceId, title: 'Private', createdBy: a.userId });

    const site = await getPublicSitePages(db, 'team');
    expect(site).not.toBeNull();
    expect(site!.pages.map((p) => p.title)).toEqual(['Published']);
  });

  it('drops archived pages from the index (v0.10.0 D5 dead-link fix)', async () => {
    const a = await createTestWorkspaceWithUser(db);
    await setPublicSite(db, { workspaceId: a.workspaceId, slug: 'team', enabled: true });

    // A page that was published (share flag + slug minted) and then archived:
    // /p/<slug> already 404'd (public.ts gates on status), so without the
    // status filter the index kept listing a dead link.
    const [archived] = await db
      .insert(schema.pages)
      .values({ workspaceId: a.workspaceId, title: 'Archived', createdBy: a.userId })
      .returning();
    await publishPage(db, {
      pageId: archived!.id,
      workspaceId: a.workspaceId,
      actorUserId: a.userId,
    });
    await db
      .update(schema.pages)
      .set({ status: 'archived' })
      .where(eq(schema.pages.id, archived!.id));

    const [live] = await db
      .insert(schema.pages)
      .values({ workspaceId: a.workspaceId, title: 'Live', createdBy: a.userId })
      .returning();
    await publishPage(db, {
      pageId: live!.id,
      workspaceId: a.workspaceId,
      actorUserId: a.userId,
    });

    const site = await getPublicSitePages(db, 'team');
    expect(site!.pages.map((p) => p.title)).toEqual(['Live']);
  });
});
