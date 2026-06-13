import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import {
  addTags,
  type DeletedCardSnapshot,
  deleteCards,
  moveToDeck,
  reattachCards,
  removeTags,
  resetSm2,
  restoreCards,
  snapshotCards,
  suspendCards,
  unsuspendCards,
} from '@/lib/flashcards/manage';

export const runtime = 'nodejs';

/**
 * POST /api/flashcards/manage/bulk — dispatch a bulk action over a set of card
 * ids. Thin wrapper over the Task A (`src/lib/flashcards/manage.ts`) mutations;
 * every helper is workspace-scoped, so a card id from another workspace is a
 * silent no-op (the `workspace_id` predicate never matches) rather than a leak.
 *
 * Audited actions (delete / reset / reattach) append an audit-log row via
 * `recordAudit` INSIDE the same transaction as the mutation (so the log can't
 * drift from the action). Metadata carries ids + counts only — never front/back
 * text, which could contain page secrets.
 *
 * `delete` returns a `snapshot` (card rows + review rows) so the client's 10s
 * undo toast can POST `{ action: 'restore', snapshot }` to bring them back with
 * SM-2 state intact.
 */

const CardIds = z.array(z.uuid()).min(1).max(1000);

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('moveToDeck'), cardIds: CardIds, deckId: z.uuid().nullable() }),
  z.object({
    action: z.literal('addTags'),
    cardIds: CardIds,
    tags: z.array(z.string().trim().min(1).max(60)).min(1).max(50),
  }),
  z.object({
    action: z.literal('removeTags'),
    cardIds: CardIds,
    tags: z.array(z.string().trim().min(1).max(60)).min(1).max(50),
  }),
  z.object({ action: z.literal('suspend'), cardIds: CardIds }),
  z.object({ action: z.literal('unsuspend'), cardIds: CardIds }),
  z.object({ action: z.literal('reset'), cardIds: CardIds }),
  z.object({ action: z.literal('reattach'), cardIds: CardIds, pageId: z.uuid() }),
  z.object({ action: z.literal('delete'), cardIds: CardIds }),
  // The undo path re-inserts a snapshot the `delete` response handed back.
  z.object({ action: z.literal('restore'), snapshot: z.array(z.unknown()).max(1000) }),
]);

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const body = Body.parse(await req.json());
    const db = getDb();

    switch (body.action) {
      case 'moveToDeck': {
        const count = await moveToDeck(db, ctx.workspaceId, body.cardIds, body.deckId);
        return NextResponse.json({ ok: true, count });
      }
      case 'addTags': {
        const count = await addTags(db, ctx.workspaceId, body.cardIds, body.tags);
        return NextResponse.json({ ok: true, count });
      }
      case 'removeTags': {
        const count = await removeTags(db, ctx.workspaceId, body.cardIds, body.tags);
        return NextResponse.json({ ok: true, count });
      }
      case 'suspend': {
        const count = await suspendCards(db, ctx.workspaceId, body.cardIds);
        return NextResponse.json({ ok: true, count });
      }
      case 'unsuspend': {
        const count = await unsuspendCards(db, ctx.workspaceId, body.cardIds);
        return NextResponse.json({ ok: true, count });
      }
      case 'reset': {
        const count = await db.transaction(async (tx) => {
          const n = await resetSm2(tx, ctx.workspaceId, ctx.userId, body.cardIds);
          await recordAudit(tx, {
            workspaceId: ctx.workspaceId,
            actorUserId: ctx.userId,
            action: 'flashcard.reset',
            targetType: 'flashcard_card',
            targetId: body.cardIds[0] ?? null,
            metadata: { count: n, cardIds: body.cardIds },
          });
          return n;
        });
        return NextResponse.json({ ok: true, count });
      }
      case 'reattach': {
        // Validate the target page is in the same workspace (else 404 — the
        // reattach helper itself only scopes the cards, not the page).
        const [page] = await db
          .select({ id: schema.pages.id, workspaceId: schema.pages.workspaceId })
          .from(schema.pages)
          .where(eq(schema.pages.id, body.pageId))
          .limit(1);
        if (!page || page.workspaceId !== ctx.workspaceId) {
          return NextResponse.json({ error: 'Page not found' }, { status: 404 });
        }
        const count = await db.transaction(async (tx) => {
          const n = await reattachCards(tx, ctx.workspaceId, body.cardIds, body.pageId);
          await recordAudit(tx, {
            workspaceId: ctx.workspaceId,
            actorUserId: ctx.userId,
            action: 'flashcard.reattached',
            targetType: 'flashcard_card',
            targetId: body.cardIds[0] ?? null,
            metadata: { count: n, cardIds: body.cardIds, pageId: body.pageId },
          });
          return n;
        });
        return NextResponse.json({ ok: true, count });
      }
      case 'delete': {
        const result = await db.transaction(async (tx) => {
          const snapshot = await snapshotCards(tx, ctx.workspaceId, body.cardIds);
          const count = await deleteCards(tx, ctx.workspaceId, body.cardIds);
          await recordAudit(tx, {
            workspaceId: ctx.workspaceId,
            actorUserId: ctx.userId,
            action: 'flashcard.deleted',
            targetType: 'flashcard_card',
            targetId: body.cardIds[0] ?? null,
            metadata: { count, cardIds: body.cardIds, bulk: body.cardIds.length > 1 },
          });
          return { count, snapshot };
        });
        return NextResponse.json({ ok: true, count: result.count, snapshot: result.snapshot });
      }
      case 'restore': {
        // The snapshot is opaque JSON the delete response handed back. Coerce
        // the date columns (which JSON.stringify rendered as ISO strings) back
        // to Dates so the insert's timestamp columns accept them, and scope the
        // restore to the caller's workspace (drop any row whose workspace_id
        // doesn't match — a tampered snapshot can't resurrect a foreign card).
        const snapshots = (body.snapshot as RawSnapshot[])
          .filter((s) => s?.card?.workspaceId === ctx.workspaceId)
          .map(hydrateSnapshot);
        const count = await restoreCards(db, snapshots);
        return NextResponse.json({ ok: true, count });
      }
    }
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}

type RawSnapshot = {
  card: Record<string, unknown> & { workspaceId?: string };
  reviews?: Record<string, unknown>[];
};

const DATE_KEYS = [
  'sourceOrphanedAt',
  'suspendedAt',
  'createdAt',
  'updatedAt',
  'dueAt',
  'lastReviewedAt',
] as const;

function reviveDates<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row };
  for (const key of DATE_KEYS) {
    const v = out[key];
    if (typeof v === 'string') (out as Record<string, unknown>)[key] = new Date(v);
  }
  return out;
}

function hydrateSnapshot(s: RawSnapshot): DeletedCardSnapshot {
  return {
    card: reviveDates(s.card) as DeletedCardSnapshot['card'],
    reviews: (s.reviews ?? []).map((r) => reviveDates(r)) as DeletedCardSnapshot['reviews'],
  };
}
