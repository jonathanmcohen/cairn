import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';

/**
 * v0.9.19 A3 (#37) — imperative twin of migration
 * `0070_backfill_default_page_status_draft.sql`. Flips every workspace still
 * carrying the pre-v0.9.9 `default_page_status = 'published'` to `'draft'`
 * (migration 0066 changed only the column DEFAULT, not existing rows, so old
 * workspaces kept minting published pages — the live miss). Idempotent: a
 * second run matches nothing. Returns the number of rows changed.
 *
 * Exposed separately from the SQL so the migration's data effect is unit
 * testable (the migration itself runs once at startup, before any test row
 * exists). Mirrors `backfillLegacyOrangeCovers` (#214).
 */
export async function backfillDefaultPageStatusDraft(
  db: PostgresJsDatabase<typeof schema>,
): Promise<number> {
  const rows = (await db.execute(sql`
    UPDATE "workspaces"
    SET "default_page_status" = 'draft'
    WHERE "default_page_status" = 'published'
    RETURNING "id"
  `)) as unknown as { id: string }[];
  return rows.length;
}
