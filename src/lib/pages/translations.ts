/**
 * v0.9.0 G4 P26 — page translation linkage.
 *
 * Bidirectional "this page is a translation of that page" pointer. `pages.translation_of_page_id`
 * is a self-FK with ON DELETE SET NULL (declared in migration 0047); `translation_locale`
 * holds the BCP-47 locale string. The "Translations" picker UI surfaces every page that
 * points at the same canonical — the canonical is whichever row has
 * `translation_of_page_id IS NULL` (or, when called from a sibling, we walk one step up).
 *
 * Refuses:
 *   - self-link (cycle of length 1)
 *   - cross-workspace canonical (translations must share a workspace)
 *   - missing page or missing canonical row
 *
 * Every successful link writes `page.translation_linked` audit with
 * `{locale, canonicalPageId}` (spec §2.27 — audit-and-mutate in one transaction).
 */
import { and, eq, isNotNull, ne, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';

export async function linkTranslation(
  db: PostgresJsDatabase<typeof schema>,
  input: { pageId: string; canonicalPageId: string; locale: string; byUserId: string },
): Promise<void> {
  if (input.pageId === input.canonicalPageId) {
    throw new Error('cannot link a page as a translation of itself');
  }
  await db.transaction(async (tx) => {
    const [page] = await tx
      .select({ id: schema.pages.id, workspaceId: schema.pages.workspaceId })
      .from(schema.pages)
      .where(eq(schema.pages.id, input.pageId))
      .limit(1);
    const [canonical] = await tx
      .select({ id: schema.pages.id, workspaceId: schema.pages.workspaceId })
      .from(schema.pages)
      .where(eq(schema.pages.id, input.canonicalPageId))
      .limit(1);
    if (!page) throw new Error('page not found');
    if (!canonical) throw new Error('canonical page not found');
    if (page.workspaceId !== canonical.workspaceId) {
      throw new Error('translation must be in the same workspace as the canonical');
    }

    await tx
      .update(schema.pages)
      .set({
        translationOfPageId: input.canonicalPageId,
        translationLocale: input.locale,
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, input.pageId));

    await recordAudit(tx, {
      workspaceId: page.workspaceId,
      actorUserId: input.byUserId,
      action: 'page.translation_linked',
      targetType: 'page',
      targetId: input.pageId,
      metadata: { locale: input.locale, canonicalPageId: input.canonicalPageId },
    });
  });
}

/**
 * Return every OTHER page linked to the same canonical as the input page id.
 *
 * Resolution: if the caller passes the canonical itself (its `translation_of_page_id`
 * is null), we return every row whose `translation_of_page_id` equals the caller.
 * If the caller passes a sibling (its `translation_of_page_id` is non-null), we
 * walk one step up to find the true canonical, then return the canonical plus
 * every other sibling — excluding the caller from the result either way.
 */
export async function listLinkedTranslations(
  db: PostgresJsDatabase<typeof schema>,
  args: { canonicalPageId: string },
): Promise<schema.Page[]> {
  const [self] = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.id, args.canonicalPageId))
    .limit(1);
  if (!self) return [];
  const trueCanonicalId = self.translationOfPageId ?? self.id;

  const linked = await db
    .select()
    .from(schema.pages)
    .where(
      and(
        or(
          eq(schema.pages.translationOfPageId, trueCanonicalId),
          eq(schema.pages.id, trueCanonicalId),
        ),
        ne(schema.pages.id, args.canonicalPageId),
        isNotNull(schema.pages.id),
      ),
    );
  return linked;
}
