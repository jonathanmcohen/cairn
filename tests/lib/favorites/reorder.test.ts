import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { reorderFavorites } from '@/lib/favorites/reorder';
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

async function seedThreeFavorites() {
  const u = await createTestWorkspaceWithUser(db);
  const a = await makePage(u.workspaceId, u.userId, 'A');
  const b = await makePage(u.workspaceId, u.userId, 'B');
  const c = await makePage(u.workspaceId, u.userId, 'C');
  const favs = await db
    .insert(schema.userPagePrefs)
    .values(
      [a, b, c].map((p, i) => ({
        userId: u.userId,
        workspaceId: u.workspaceId,
        pageId: p.id,
        favorite: true,
        position: i,
      })),
    )
    .returning({ id: schema.userPagePrefs.id, pageId: schema.userPagePrefs.pageId });
  return { userId: u.userId, workspaceId: u.workspaceId, favs };
}

describe('reorderFavorites', () => {
  it('writes new positions 0..N in the given order (single tx)', async () => {
    const { userId, workspaceId, favs } = await seedThreeFavorites();
    const reordered = [favs[2]!.id, favs[0]!.id, favs[1]!.id];
    await reorderFavorites(db, { userId, workspaceId, orderedFavoriteIds: reordered });

    const rows = await db
      .select()
      .from(schema.userPagePrefs)
      .where(
        and(
          eq(schema.userPagePrefs.userId, userId),
          eq(schema.userPagePrefs.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(schema.userPagePrefs.position));
    expect(rows.map((r) => r.id)).toEqual(reordered);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it('is idempotent — re-running with the same order is a no-op', async () => {
    const { userId, workspaceId, favs } = await seedThreeFavorites();
    const order = favs.map((f) => f.id);
    await reorderFavorites(db, { userId, workspaceId, orderedFavoriteIds: order });
    await reorderFavorites(db, { userId, workspaceId, orderedFavoriteIds: order });
    const rows = await db
      .select()
      .from(schema.userPagePrefs)
      .where(eq(schema.userPagePrefs.userId, userId))
      .orderBy(asc(schema.userPagePrefs.position));
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it("skips cross-user favorite ids — the other user's rows are not touched", async () => {
    const a = await seedThreeFavorites();
    const b = await seedThreeFavorites();

    await reorderFavorites(db, {
      userId: a.userId,
      workspaceId: a.workspaceId,
      orderedFavoriteIds: [a.favs[2]!.id, b.favs[0]!.id, a.favs[0]!.id, a.favs[1]!.id],
    });

    const aRows = await db
      .select()
      .from(schema.userPagePrefs)
      .where(eq(schema.userPagePrefs.userId, a.userId))
      .orderBy(asc(schema.userPagePrefs.position));
    // Only a's rows reordered. With CASE-based update, present-in-payload a-rows
    // receive position 0,2,3 (their indices in the payload); the foreign id at
    // index 1 is dropped (b's row), so a's positions are sparse [0,2,3] not [0,1,2].
    expect(aRows.map((r) => r.id)).toEqual([a.favs[2]!.id, a.favs[0]!.id, a.favs[1]!.id]);
    expect(aRows.map((r) => r.position)).toEqual([0, 2, 3]);

    const bRows = await db
      .select()
      .from(schema.userPagePrefs)
      .where(eq(schema.userPagePrefs.userId, b.userId))
      .orderBy(asc(schema.userPagePrefs.position));
    // b's rows untouched in their original 0,1,2 order.
    expect(bRows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it('is atomic on rollback — a failure inside an outer tx leaves no partial writes', async () => {
    const { userId, workspaceId, favs } = await seedThreeFavorites();

    await expect(
      db.transaction(async (tx) => {
        await reorderFavorites(tx, {
          userId,
          workspaceId,
          orderedFavoriteIds: [favs[2]!.id, favs[0]!.id, favs[1]!.id],
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const rows = await db
      .select()
      .from(schema.userPagePrefs)
      .where(eq(schema.userPagePrefs.userId, userId))
      .orderBy(asc(schema.userPagePrefs.position));
    expect(rows.map((r) => r.id)).toEqual(favs.map((f) => f.id));
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });
});
