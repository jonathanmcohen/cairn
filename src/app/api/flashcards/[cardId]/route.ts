import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { getAuthContext, HttpError, hasMinRole, requireWorkspace } from '@/lib/auth/require-role';
import {
  addTags,
  deleteCards,
  moveToDeck,
  removeTags,
  snapshotCards,
  suspendCards,
  unsuspendCards,
} from '@/lib/flashcards/manage';
import { applyFlashcardEditToContent } from '@/lib/flashcards/write-through';
import { updatePage } from '@/lib/pages/update';

export const runtime = 'nodejs';

/**
 * PATCH  /api/flashcards/[cardId] — per-card edit (front/back, deck, tags,
 *        suspend). When the card is ATTACHED (page_id + block_id set and not
 *        orphaned), a front/back/deck edit writes THROUGH to the source block:
 *        we patch the page content JSON (the source of truth) and persist via
 *        `updatePage`, which re-reconciles the `flashcard_cards` row from the
 *        doc AND publishes into any live Yjs session. Detached/orphaned cards
 *        update the row directly (there is no block to write through to).
 * DELETE /api/flashcards/[cardId] — single hard delete + audit row.
 *
 * Workspace-scoped: a card from another workspace resolves to 404 (existence-
 * hiding), mirroring the grade route.
 */

const Patch = z.object({
  front: z.string().max(10000).optional(),
  back: z.string().max(10000).optional(),
  deckId: z.uuid().nullable().optional(),
  setTags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  suspended: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ cardId: string }> },
): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const { cardId } = await params;
    if (!z.uuid().safeParse(cardId).success) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }
    const patch = Patch.parse(await req.json());
    const db = getDb();

    const [card] = await db
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, cardId))
      .limit(1);
    if (!card || card.workspaceId !== ctx.workspaceId) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    // Front/back/deck text edit. If the card is attached to a live page block,
    // write through to the source content so the next page-save reconcile can't
    // clobber the edit; otherwise update the card row directly.
    const editsText = patch.front !== undefined || patch.back !== undefined;
    const attached =
      card.pageId !== null && card.sourceOrphanedAt === null && card.blockId.length > 0;

    if (editsText && attached && card.pageId) {
      const [page] = await db
        .select({ content: schema.pages.content })
        .from(schema.pages)
        .where(eq(schema.pages.id, card.pageId))
        .limit(1);
      if (page) {
        const { found, content } = applyFlashcardEditToContent(page.content, card.blockId, {
          ...(patch.front !== undefined ? { front: patch.front } : {}),
          ...(patch.back !== undefined ? { back: patch.back } : {}),
        });
        if (found) {
          // updatePage re-reconciles the card row from the patched doc (so the
          // row's front/back end up updated too) and publishes to collab.
          await updatePage(db, {
            pageId: card.pageId,
            workspaceId: ctx.workspaceId,
            patch: { content },
            byUserId: ctx.userId,
            adminOverride: hasMinRole(ctx.role, 'admin'),
          });
        } else {
          // Block id no longer in the doc — fall back to a row-only update so
          // the edit isn't silently dropped (the card is effectively detached).
          await db
            .update(schema.flashcardCards)
            .set({
              ...(patch.front !== undefined ? { front: patch.front } : {}),
              ...(patch.back !== undefined ? { back: patch.back } : {}),
              updatedAt: new Date(),
            })
            .where(eq(schema.flashcardCards.id, cardId));
        }
      }
    } else if (editsText) {
      // Detached / orphaned card: the row IS the source of truth.
      await db
        .update(schema.flashcardCards)
        .set({
          ...(patch.front !== undefined ? { front: patch.front } : {}),
          ...(patch.back !== undefined ? { back: patch.back } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.flashcardCards.id, cardId));
    }

    // Deck move (reuses the bulk helper for a single id).
    if (patch.deckId !== undefined) {
      await moveToDeck(db, ctx.workspaceId, [cardId], patch.deckId);
    }

    // Tag replace: diff against current tags so we reuse the union/remove
    // helpers rather than overwriting the array column directly.
    if (patch.setTags !== undefined) {
      const next = [...new Set(patch.setTags)];
      const current = card.tags;
      const toAdd = next.filter((t) => !current.includes(t));
      const toRemove = current.filter((t) => !next.includes(t));
      if (toAdd.length > 0) await addTags(db, ctx.workspaceId, [cardId], toAdd);
      if (toRemove.length > 0) await removeTags(db, ctx.workspaceId, [cardId], toRemove);
    }

    // Suspend toggle.
    if (patch.suspended === true) await suspendCards(db, ctx.workspaceId, [cardId]);
    else if (patch.suspended === false) await unsuspendCards(db, ctx.workspaceId, [cardId]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ cardId: string }> },
): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const { cardId } = await params;
    if (!z.uuid().safeParse(cardId).success) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }
    const db = getDb();
    const result = await db.transaction(async (tx) => {
      const snapshot = await snapshotCards(tx, ctx.workspaceId, [cardId]);
      if (snapshot.length === 0) return null;
      const count = await deleteCards(tx, ctx.workspaceId, [cardId]);
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        action: 'flashcard.deleted',
        targetType: 'flashcard_card',
        targetId: cardId,
        metadata: { count, cardIds: [cardId], bulk: false },
      });
      return { count, snapshot };
    });
    if (!result) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, count: result.count, snapshot: result.snapshot });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json({ error: 'internal' }, { status: 500 });
}
