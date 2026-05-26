import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { emit } from '@/lib/webhooks/dispatch';
import { buildPageWebhookPayload } from '@/lib/webhooks/payload';
import { randomDefaultIcon } from './default-icon';
import { emptyDocument } from './empty-document';
import { formatIcon } from './icon-format';

export type CreatePageInput = {
  workspaceId: string;
  createdBy: string;
  parentId?: string;
  title?: string;
  icon?: string | null;
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
    const [page] = await tx
      .insert(schema.pages)
      .values({
        workspaceId: input.workspaceId,
        parentId: input.parentId ?? null,
        title: input.title ?? 'Untitled',
        icon: input.icon ?? formatIcon({ kind: 'emoji', value: randomDefaultIcon() }),
        content: emptyDocument(),
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
