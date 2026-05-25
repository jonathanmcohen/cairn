import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

// Accept either a top-level db or a transaction handle. PostgresJsTransaction
// is a structural subtype of PostgresJsDatabase, mirroring the pattern in
// src/lib/audit/record.ts.
type Db = PostgresJsDatabase<typeof schema>;

export type ReorderFavoritesInput = {
  userId: string;
  workspaceId: string;
  /** user_page_prefs.id values in the desired new order (positions = index). */
  orderedFavoriteIds: string[];
};

/**
 * Reassign `position` on the caller's favorites to match the passed order.
 * Cross-user ids in the payload are silently dropped (not 403) — the helper
 * narrows the UPDATE to (userId, workspaceId) so foreign rows can never be
 * touched. The whole reassignment runs in a single UPDATE inside one
 * transaction (or inside an outer tx when one is passed).
 */
export async function reorderFavorites(db: Db, input: ReorderFavoritesInput): Promise<void> {
  if (input.orderedFavoriteIds.length === 0) return;

  await db.transaction(async (tx) => {
    // Single CASE-based UPDATE: every targeted row gets its new position
    // assigned in one statement, so we never race a temporary uniqueness
    // conflict on `(userId, workspaceId, position)` (no UNIQUE exists today,
    // but the pattern is the safe default if we add one later).
    const cases = input.orderedFavoriteIds.map(
      (id, position) => sql`WHEN ${schema.userPagePrefs.id} = ${id} THEN ${position}::int`,
    );
    await tx
      .update(schema.userPagePrefs)
      .set({
        position: sql`CASE ${sql.join(cases, sql` `)} ELSE ${schema.userPagePrefs.position} END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.userPagePrefs.userId, input.userId),
          eq(schema.userPagePrefs.workspaceId, input.workspaceId),
          inArray(schema.userPagePrefs.id, input.orderedFavoriteIds),
        ),
      );
  });
}
