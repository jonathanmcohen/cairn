import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Max number of recent pages retained per user. Pruned on each recordVisit. */
export const RECENTS_CAP = 20;

export type PrefEntry = { pageId: string; title: string; icon: string | null };

type Scope = { userId: string; workspaceId: string };

/**
 * Toggle a page's favorite flag for a user. Creates the prefs row if absent.
 * Returns the new favorite state. When turning favorite ON, assigns the next
 * slot (max(position) + 1) so the list is stably ordered. v0.8 P17 writes both
 * `position` (canonical) and `favorite_order` (v0.6-era column kept for
 * back-compat) so callers reading either column see the same result.
 */
export async function toggleFavorite(db: Db, input: Scope & { pageId: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.userPagePrefs)
      .where(
        and(
          eq(schema.userPagePrefs.userId, input.userId),
          eq(schema.userPagePrefs.pageId, input.pageId),
        ),
      )
      .limit(1);

    const nextFav = !(existing?.favorite ?? false);

    let order = 0;
    if (nextFav) {
      const [maxRow] = await tx
        .select({ max: sql<number | null>`max(${schema.userPagePrefs.position})` })
        .from(schema.userPagePrefs)
        .where(
          and(
            eq(schema.userPagePrefs.userId, input.userId),
            eq(schema.userPagePrefs.workspaceId, input.workspaceId),
            eq(schema.userPagePrefs.favorite, true),
          ),
        );
      order = (maxRow?.max ?? -1) + 1;
    }

    if (existing) {
      await tx
        .update(schema.userPagePrefs)
        .set({
          favorite: nextFav,
          favoriteOrder: nextFav ? order : null,
          position: nextFav ? order : 0,
          updatedAt: new Date(),
        })
        .where(eq(schema.userPagePrefs.id, existing.id));
    } else {
      await tx.insert(schema.userPagePrefs).values({
        userId: input.userId,
        workspaceId: input.workspaceId,
        pageId: input.pageId,
        favorite: nextFav,
        favoriteOrder: nextFav ? order : null,
        position: order,
      });
    }
    return nextFav;
  });
}

/**
 * Rewrite favorite ordering for the user to match `orderedPageIds`. Page ids
 * not currently favorited by the user are ignored (no row is created). v0.8
 * P17 writes both `position` (canonical) and `favorite_order` (v0.6 column,
 * kept for back-compat) so legacy callers and the new sidebar see the same
 * ordering. New code should prefer `@/lib/favorites/reorder#reorderFavorites`
 * which uses `user_page_prefs.id` (not pageId) for stronger ownership scoping.
 */
export async function reorderFavorites(
  db: Db,
  input: Scope & { orderedPageIds: string[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    const favs = await tx
      .select({ pageId: schema.userPagePrefs.pageId })
      .from(schema.userPagePrefs)
      .where(
        and(
          eq(schema.userPagePrefs.userId, input.userId),
          eq(schema.userPagePrefs.workspaceId, input.workspaceId),
          eq(schema.userPagePrefs.favorite, true),
        ),
      );
    const favIds = new Set(favs.map((f) => f.pageId));
    let order = 0;
    for (const pageId of input.orderedPageIds) {
      if (!favIds.has(pageId)) continue;
      await tx
        .update(schema.userPagePrefs)
        .set({ favoriteOrder: order, position: order, updatedAt: new Date() })
        .where(
          and(
            eq(schema.userPagePrefs.userId, input.userId),
            eq(schema.userPagePrefs.pageId, pageId),
          ),
        );
      order += 1;
    }
  });
}

/**
 * Mark a page as visited now (upsert). Then prune the user's NON-favorite
 * visited rows beyond RECENTS_CAP (favorites are never pruned — they carry the
 * favorite flag/order even if their visit is old).
 *
 * Prune strategy: collect ids of non-favorite visited rows for this
 * user+workspace ordered by lastVisitedAt DESC, slice off the first
 * `RECENTS_CAP`, and delete the rest. The fixed cap keeps the in-process
 * slicing cheap (≤ a few dozen rows per user).
 */
export async function recordVisit(db: Db, input: Scope & { pageId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .insert(schema.userPagePrefs)
      .values({
        userId: input.userId,
        workspaceId: input.workspaceId,
        pageId: input.pageId,
        lastVisitedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.userPagePrefs.userId, schema.userPagePrefs.pageId],
        set: { lastVisitedAt: now, updatedAt: now },
      });

    // Find non-favorite visited rows beyond the cap (newest first; oldest get pruned).
    const visited = await tx
      .select({ id: schema.userPagePrefs.id })
      .from(schema.userPagePrefs)
      .where(
        and(
          eq(schema.userPagePrefs.userId, input.userId),
          eq(schema.userPagePrefs.workspaceId, input.workspaceId),
          eq(schema.userPagePrefs.favorite, false),
          isNotNull(schema.userPagePrefs.lastVisitedAt),
        ),
      )
      .orderBy(desc(schema.userPagePrefs.lastVisitedAt));
    const toPrune = visited.slice(RECENTS_CAP).map((r) => r.id);
    if (toPrune.length > 0) {
      await tx.delete(schema.userPagePrefs).where(inArray(schema.userPagePrefs.id, toPrune));
    }
  });
}

/** Ordered favorites for the user in the active workspace (joined to page title/icon). */
export async function listFavorites(db: Db, scope: Scope): Promise<PrefEntry[]> {
  const rows = await db
    .select({
      pageId: schema.userPagePrefs.pageId,
      title: schema.pages.title,
      icon: schema.pages.icon,
    })
    .from(schema.userPagePrefs)
    .innerJoin(schema.pages, eq(schema.pages.id, schema.userPagePrefs.pageId))
    .where(
      and(
        eq(schema.userPagePrefs.userId, scope.userId),
        eq(schema.userPagePrefs.workspaceId, scope.workspaceId),
        eq(schema.userPagePrefs.favorite, true),
        sql`${schema.pages.deletedAt} is null`,
      ),
    )
    .orderBy(asc(schema.userPagePrefs.position), asc(schema.userPagePrefs.createdAt));
  return rows.map((r) => ({ pageId: r.pageId, title: r.title, icon: r.icon }));
}

/** Most-recently-visited pages for the user, capped to RECENTS_CAP. */
export async function listRecents(db: Db, scope: Scope): Promise<PrefEntry[]> {
  const rows = await db
    .select({
      pageId: schema.userPagePrefs.pageId,
      title: schema.pages.title,
      icon: schema.pages.icon,
    })
    .from(schema.userPagePrefs)
    .innerJoin(schema.pages, eq(schema.pages.id, schema.userPagePrefs.pageId))
    .where(
      and(
        eq(schema.userPagePrefs.userId, scope.userId),
        eq(schema.userPagePrefs.workspaceId, scope.workspaceId),
        isNotNull(schema.userPagePrefs.lastVisitedAt),
        sql`${schema.pages.deletedAt} is null`,
      ),
    )
    .orderBy(desc(schema.userPagePrefs.lastVisitedAt))
    .limit(RECENTS_CAP);
  return rows.map((r) => ({ pageId: r.pageId, title: r.title, icon: r.icon }));
}
