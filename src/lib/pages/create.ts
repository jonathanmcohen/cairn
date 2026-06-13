import { and, eq, isNull, sql as rawSql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { emit } from '@/lib/webhooks/dispatch';
import { buildPageWebhookPayload } from '@/lib/webhooks/payload';
import { DEFAULT_PAGE_ICON } from './default-icon';
import { emptyDocument } from './empty-document';
import { formatIcon } from './icon-format';
import { POSITION_GAP } from './position';

export type CreatePageInput = {
  workspaceId: string;
  createdBy: string;
  parentId?: string;
  title?: string;
  icon?: string | null;
  // v0.9.0 G2 P11 — optional space pointer. Null/undefined → "Unfiled" in the
  // sidebar. Caller (route) verifies space access before invoking createPage.
  spaceId?: string | null;
};

export async function createPage(
  db: PostgresJsDatabase<typeof schema>,
  input: CreatePageInput,
): Promise<schema.Page> {
  const page = await db.transaction(async (tx) => {
    if (input.parentId) {
      const [parent] = await tx
        .select({ workspaceId: schema.pages.workspaceId })
        .from(schema.pages)
        .where(
          and(eq(schema.pages.id, input.parentId), eq(schema.pages.workspaceId, input.workspaceId)),
        )
        .limit(1);
      if (!parent) {
        throw new Error('parent page is missing or belongs to a different workspace');
      }
    }
    // v0.9.0 G4 P26 — honor the workspace's `default_page_status` so admins
    // who set the default to 'published' get published pages on create.
    // v0.9.9 K2 #216 — the workspace default is now 'draft' (security-adjacent:
    // new pages are not auto-published before review); admins can still set the
    // default to 'published'. The fallback below matches the new column default.
    const [ws] = await tx
      .select({ defaultPageStatus: schema.workspaces.defaultPageStatus })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, input.workspaceId))
      .limit(1);
    const defaultStatus = (ws?.defaultPageStatus ?? 'draft') as schema.PageStatus;
    // v0.10.2 S8 — a brand-new page lands LAST among its siblings: gap-numbered
    // position = max(sibling position) + POSITION_GAP (the tree orders by
    // (position ASC, createdAt ASC); see 0076_page_position.sql).
    const [maxRow] = await tx
      .select({ max: rawSql<number | null>`max(${schema.pages.position})` })
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.workspaceId, input.workspaceId),
          input.parentId
            ? eq(schema.pages.parentId, input.parentId)
            : isNull(schema.pages.parentId),
          isNull(schema.pages.deletedAt),
        ),
      );
    const position = (maxRow?.max ?? 0) + POSITION_GAP;
    const [page] = await tx
      .insert(schema.pages)
      .values({
        workspaceId: input.workspaceId,
        parentId: input.parentId ?? null,
        position,
        spaceId: input.spaceId ?? null,
        // v0.9.9 K1 #215/#206 — a brand-new page is born title-less; the editor
        // shows the localized placeholder, never a literal 'Untitled'.
        title: input.title ?? '',
        icon: input.icon ?? formatIcon({ kind: 'emoji', value: DEFAULT_PAGE_ICON }),
        content: emptyDocument(),
        status: defaultStatus,
        createdBy: input.createdBy,
      })
      .returning();
    if (!page) throw new Error('failed to insert page');
    return page;
  });
  // Fire-and-forget webhook (self-guarding; never throws into the caller).
  // Newly created pages are never encrypted (the create path bypasses E2E),
  // but the payload builder normalizes the shape for downstream consumers.
  void emit(
    'page.created',
    page.workspaceId,
    buildPageWebhookPayload({
      event: 'page.created',
      page: { id: page.id, title: page.title, encrypted: page.encrypted },
    }),
  );
  // Fire-and-forget: regenerate the embedding off the request path. Never
  // blocks the create; errors logged but never thrown. (v0.7.0 G4 P12.)
  // The CAIRN_DISABLE_EMBED_HOOK escape hatch mirrors update.ts — see
  // tests/setup.ts for why the test suite sets it.
  if (process.env.CAIRN_DISABLE_EMBED_HOOK !== '1') {
    setImmediate(() => {
      void (async () => {
        try {
          const { embedPage } = await import('@/lib/search/embed-page');
          await embedPage(db, page.id);
        } catch (err) {
          const { logger } = await import('@/lib/observability/logger');
          logger.warn({ err, pageId: page.id }, 'embedPage failed (page-create hook)');
        }
      })();
    });
  }
  return page;
}
