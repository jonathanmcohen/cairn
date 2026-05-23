import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  listFavorites,
  listRecents,
  recordVisit,
  reorderFavorites,
  toggleFavorite,
} from '@/lib/prefs/user-page-prefs';
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
  await sql`TRUNCATE user_page_prefs, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function makePage(workspaceId: string, userId: string, title = 'P') {
  const [p] = await db
    .insert(schema.pages)
    .values({ workspaceId, title, createdBy: userId })
    .returning();
  if (!p) throw new Error('page insert failed');
  return p;
}

describe('toggleFavorite', () => {
  it('favorites a page (creating the row) then un-favorites it (idempotent)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const p = await makePage(u.workspaceId, u.userId);

    const on = await toggleFavorite(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      pageId: p.id,
    });
    expect(on).toBe(true);
    expect(
      (await listFavorites(db, { userId: u.userId, workspaceId: u.workspaceId })).map(
        (f) => f.pageId,
      ),
    ).toEqual([p.id]);

    const off = await toggleFavorite(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      pageId: p.id,
    });
    expect(off).toBe(false);
    expect(await listFavorites(db, { userId: u.userId, workspaceId: u.workspaceId })).toEqual([]);
  });

  it('assigns favorite_order at the end and listFavorites returns them in order', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await makePage(u.workspaceId, u.userId, 'A');
    const b = await makePage(u.workspaceId, u.userId, 'B');
    await toggleFavorite(db, { userId: u.userId, workspaceId: u.workspaceId, pageId: a.id });
    await toggleFavorite(db, { userId: u.userId, workspaceId: u.workspaceId, pageId: b.id });
    const favs = await listFavorites(db, { userId: u.userId, workspaceId: u.workspaceId });
    expect(favs.map((f) => f.pageId)).toEqual([a.id, b.id]);
    expect(favs.map((f) => f.title)).toEqual(['A', 'B']);
  });
});

describe('reorderFavorites', () => {
  it('rewrites favorite_order to the given page id sequence', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await makePage(u.workspaceId, u.userId, 'A');
    const b = await makePage(u.workspaceId, u.userId, 'B');
    const c = await makePage(u.workspaceId, u.userId, 'C');
    for (const p of [a, b, c]) {
      await toggleFavorite(db, { userId: u.userId, workspaceId: u.workspaceId, pageId: p.id });
    }
    await reorderFavorites(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      orderedPageIds: [c.id, a.id, b.id],
    });
    const favs = await listFavorites(db, { userId: u.userId, workspaceId: u.workspaceId });
    expect(favs.map((f) => f.pageId)).toEqual([c.id, a.id, b.id]);
  });

  it('ignores page ids that are not favorited by this user', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await makePage(u.workspaceId, u.userId, 'A');
    const stray = await makePage(u.workspaceId, u.userId, 'stray');
    await toggleFavorite(db, { userId: u.userId, workspaceId: u.workspaceId, pageId: a.id });
    await reorderFavorites(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      orderedPageIds: [stray.id, a.id],
    });
    const favs = await listFavorites(db, { userId: u.userId, workspaceId: u.workspaceId });
    expect(favs.map((f) => f.pageId)).toEqual([a.id]);
  });
});

describe('recordVisit + listRecents', () => {
  it('upserts last_visited_at and returns most-recent-first', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await makePage(u.workspaceId, u.userId, 'A');
    const b = await makePage(u.workspaceId, u.userId, 'B');
    await recordVisit(db, { userId: u.userId, workspaceId: u.workspaceId, pageId: a.id });
    await recordVisit(db, { userId: u.userId, workspaceId: u.workspaceId, pageId: b.id });
    // re-visit A → it moves to the front
    await recordVisit(db, { userId: u.userId, workspaceId: u.workspaceId, pageId: a.id });
    const recents = await listRecents(db, { userId: u.userId, workspaceId: u.workspaceId });
    expect(recents.map((r) => r.pageId)).toEqual([a.id, b.id]);
  });

  it('caps recents to RECENTS_CAP, pruning the oldest visited rows', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const pages = [];
    for (let i = 0; i < 25; i++) pages.push(await makePage(u.workspaceId, u.userId, `P${i}`));
    for (const p of pages) {
      await recordVisit(db, { userId: u.userId, workspaceId: u.workspaceId, pageId: p.id });
    }
    const recents = await listRecents(db, { userId: u.userId, workspaceId: u.workspaceId });
    expect(recents.length).toBeLessThanOrEqual(20); // RECENTS_CAP
    // the most recently visited (last loop iteration) is present and first
    expect(recents[0]?.pageId).toBe(pages[24]?.id);
  });

  it('a favorited page is NOT pruned from the prefs row even if its visit is old', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const fav = await makePage(u.workspaceId, u.userId, 'fav');
    await toggleFavorite(db, { userId: u.userId, workspaceId: u.workspaceId, pageId: fav.id });
    await recordVisit(db, { userId: u.userId, workspaceId: u.workspaceId, pageId: fav.id });
    for (let i = 0; i < 25; i++) {
      const p = await makePage(u.workspaceId, u.userId, `P${i}`);
      await recordVisit(db, { userId: u.userId, workspaceId: u.workspaceId, pageId: p.id });
    }
    // favorite still present (favorites must survive recents pruning)
    const favs = await listFavorites(db, { userId: u.userId, workspaceId: u.workspaceId });
    expect(favs.map((f) => f.pageId)).toContain(fav.id);
  });
});
