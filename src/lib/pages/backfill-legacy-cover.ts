import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '@/db/schema';
import type { PageCover } from '@/lib/pages/cover';
import { DEFAULT_COVER_PRESET_KEY } from '@/lib/pages/cover-presets';

/**
 * #214 — the harsh orange/amber hexes the original v0.8.0 picker offered
 * (dropped from the curated palette in v0.9.6 but never backfilled on
 * existing rows). Lowercased; the migration matches case-insensitively.
 */
export const LEGACY_ORANGE_HEXES = ['#ea580c', '#d97706'] as const;

export function isLegacyOrangeCover(cover: PageCover): boolean {
  return (
    'kind' in cover &&
    cover.kind === 'color' &&
    (LEGACY_ORANGE_HEXES as readonly string[]).includes(cover.value.toLowerCase())
  );
}

/** The curated preset legacy orange covers are reassigned to. */
export const LEGACY_ORANGE_REPLACEMENT: PageCover = {
  kind: 'preset',
  value: DEFAULT_COVER_PRESET_KEY,
};

/** Imperative twin of migration 0068 for tests + re-runnable maintenance. Idempotent. */
export async function backfillLegacyOrangeCovers(
  db: PostgresJsDatabase<typeof schema>,
): Promise<number> {
  const res = await db.execute(sql`
    UPDATE "pages"
    SET "cover" = '{"kind":"preset","value":"slate-dusk"}'::jsonb,
        "updated_at" = now()
    WHERE "cover" ->> 'kind' = 'color'
      AND lower("cover" ->> 'value') IN ('#ea580c', '#d97706')
  `);
  return (res as unknown as { count: number }).count ?? 0;
}
