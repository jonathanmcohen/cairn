import * as schema from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Resolve a page for the public render surface. Returns the page only when it is
 * published, slug-matched, and not soft-deleted; otherwise null. This is the sole
 * authorization gate for `/p/<slug>` — no session involved.
 */
export async function getPublishedPageBySlug(
  db: PostgresJsDatabase<typeof schema>,
  slug: string,
): Promise<schema.Page | null> {
  const [page] = await db
    .select()
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.publicSlug, slug),
        eq(schema.pages.published, true),
        isNull(schema.pages.deletedAt),
      ),
    )
    .limit(1);
  return page ?? null;
}
