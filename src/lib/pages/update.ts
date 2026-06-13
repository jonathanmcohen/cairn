import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { extractDateTimesFromDoc } from '@/lib/datetime/extract-from-doc';
import { reconcileFlashcards } from '@/lib/flashcards/reconcile';
import { requireUnlocked } from '@/lib/pages/lock';
import { reindexPageLinks } from '@/lib/pages/page-links';
import { emit } from '@/lib/webhooks/dispatch';
import { buildPageWebhookPayload } from '@/lib/webhooks/payload';

export class PageConflictError extends Error {
  constructor(message = 'Page has been modified since you last read it') {
    super(message);
    this.name = 'PageConflictError';
  }
}

export type UpdatePageInput = {
  pageId: string;
  workspaceId: string;
  patch: Partial<{
    title: string;
    icon: string | null;
    coverUrl: string | null;
    content: unknown;
    metadata: Record<string, unknown>;
  }>;
  expectedUpdatedAt?: Date;
  // v0.9.0 G2 P14 — caller identity used by the page-lock gate. `byUserId` is
  // the actor; `adminOverride` lets an admin bypass another user's lock and
  // is normally `hasMinRole(ctx.role, 'admin')`. The two are required so
  // call-sites can't accidentally write through a lock by omitting them.
  byUserId: string;
  adminOverride: boolean;
};

export async function updatePage(
  db: PostgresJsDatabase<typeof schema>,
  input: UpdatePageInput,
): Promise<schema.Page> {
  await requireUnlocked(db, {
    pageId: input.pageId,
    byUserId: input.byUserId,
    adminOverride: input.adminOverride,
  });
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.id, input.pageId),
          eq(schema.pages.workspaceId, input.workspaceId),
          isNull(schema.pages.deletedAt),
        ),
      )
      .limit(1);
    if (!current) throw new Error('Page not found');
    if (
      input.expectedUpdatedAt &&
      current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new PageConflictError();
    }

    const values: Partial<schema.NewPage> = {};
    if (input.patch.title !== undefined) values.title = input.patch.title;
    if (input.patch.icon !== undefined) values.icon = input.patch.icon;
    if (input.patch.coverUrl !== undefined) values.coverUrl = input.patch.coverUrl;

    // v0.9.7 G19 #166 — merge any metadata writes (content datetime side-channel
    // + explicit metadata patch e.g. citation prefs) over the existing row
    // metadata so no single channel clobbers the others.
    let mergedMetadata = (current.metadata ?? {}) as Record<string, unknown>;
    let metadataChanged = false;
    if (input.patch.content !== undefined) {
      // CONTENT-WRITE PRECEDENCE (#A3, fixed v0.9.15):
      // While a Hocuspocus collab session holds a Y.Doc open for this page,
      // collab/server.ts#materialize() overwrites `pages.content` with the Yjs
      // state on the next debounce flush (≤2s) or last-disconnect. To stop that
      // from silently losing this REST PATCH, we PUBLISH the new content into
      // the live Y.Doc after committing the DB write (see publishContentToCollab
      // below). If no session is open, the publish is a no-op and the DB write
      // is authoritative. The publish is best-effort and never blocks/breaks the
      // save. See: tests/api/pages-content-patch-vs-yjs.spec.ts.
      values.content = input.patch.content as never;
      // v0.9.0 G3 P20 — extract ISO timestamps from every `datetime` block in
      // the saved doc and stash their ms-epoch values into `metadata.datetimes`.
      // P29's date-range search filter reads this side-channel rather than
      // re-parsing `content` jsonb on every query.
      const dts = extractDateTimesFromDoc(
        input.patch.content as Parameters<typeof extractDateTimesFromDoc>[0],
      );
      mergedMetadata = { ...mergedMetadata, datetimes: dts.map((d) => d.epochMs) };
      metadataChanged = true;
    }
    if (input.patch.metadata !== undefined) {
      mergedMetadata = { ...mergedMetadata, ...input.patch.metadata };
      metadataChanged = true;
    }
    if (metadataChanged) {
      values.metadata = mergedMetadata;
    }

    const [updated] = await tx
      .update(schema.pages)
      .set(values)
      .where(eq(schema.pages.id, current.id))
      .returning();
    if (!updated) throw new Error('Update returned no row');
    // Keep the page_links index in lockstep with the saved doc. Inside the same
    // transaction so a failed reindex rolls back the content write (index must
    // never drift from `pages.content`).
    if (input.patch.content !== undefined) {
      await reindexPageLinks(tx, current.id, input.patch.content);
      // v0.9.0 G3 P19 — keep flashcard_cards in lockstep with `flashcard`
      // blocks in the saved doc. Same in-tx rationale as page-links.
      // v0.10.2 F2-D — reconcile may BACKFILL a resolved cardId into a block
      // (mutating `input.patch.content` in place). When it does, re-persist the
      // now-stamped content INSIDE the tx so the saved jsonb carries the cardId,
      // and the post-commit publishContentToCollab (which sends the SAME object
      // reference) pushes the stamped content into any open editor. The backfill
      // is idempotent, so a subsequent save resolves by reference and changes
      // nothing (convergence).
      const { contentChanged } = await reconcileFlashcards(tx, {
        pageId: current.id,
        workspaceId: input.workspaceId,
        userId: input.byUserId,
        content: input.patch.content,
      });
      if (contentChanged) {
        await tx
          .update(schema.pages)
          .set({ content: input.patch.content as never })
          .where(eq(schema.pages.id, current.id));
      }
    }
    return updated;
  });
  // #A3 (v0.9.15) — push the freshly-written content into the live Yjs doc (if a
  // collab session holds it open) so a subsequent materialize() flush can't
  // clobber this PATCH. Best-effort + fail-open: the DB write above is already
  // committed, so a collab outage never breaks the save. No-ops when
  // CAIRN_COLLAB_INTERNAL_URL is unset (single-process deploys / tests).
  if (input.patch.content !== undefined) {
    void (async () => {
      try {
        const { publishContentToCollab } = await import('@/lib/collab/publish-client');
        await publishContentToCollab({ pageId: input.pageId, content: input.patch.content });
      } catch (err) {
        const { logger } = await import('@/lib/observability/logger');
        logger.warn({ err, pageId: input.pageId }, 'publishContentToCollab dispatch failed');
      }
    })();
  }
  // Fire-and-forget webhook (self-guarding; never throws into the caller).
  // The payload builder fails-closed: encrypted pages get body:null +
  // page.encrypted=true so downstream consumers never see ciphertext or
  // stale plaintext (v0.9.0 G1 P6).
  void emit(
    'page.updated',
    updated.workspaceId,
    buildPageWebhookPayload({
      event: 'page.updated',
      page: {
        id: updated.id,
        title: updated.title,
        encrypted: updated.encrypted,
      },
    }),
  );
  // Fire-and-forget: regenerate the embedding off the request path. Never
  // blocks the update; errors logged but never thrown. (v0.7.0 G4 P12.)
  // The CAIRN_DISABLE_EMBED_HOOK escape hatch is set in tests/setup.ts so
  // background embed work can't race the next test's TRUNCATE; production
  // never sets it.
  if (process.env.CAIRN_DISABLE_EMBED_HOOK !== '1') {
    setImmediate(() => {
      void (async () => {
        try {
          const { embedPage } = await import('@/lib/search/embed-page');
          await embedPage(db, updated.id);
        } catch (err) {
          const { logger } = await import('@/lib/observability/logger');
          logger.warn({ err, pageId: updated.id }, 'embedPage failed (page-update hook)');
        }
      })();
    });
  }
  return updated;
}
