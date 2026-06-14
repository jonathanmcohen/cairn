import { and, count, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
import { getWorkspaceFlashcardSettings } from '@/lib/flashcards/settings';
import { scheduleNext } from '@/lib/flashcards/sm2';

export const runtime = 'nodejs';

const Body = z.object({
  cardId: z.uuid(),
  grade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

/**
 * POST /api/flashcards/grade — record a review of a flashcard. Runs SM-2
 * against the caller's current `(ease, interval)` state and upserts the
 * `flashcard_reviews` row. Access check: the card must live in the active
 * workspace; cross-workspace cards return 404 (mirrors the page-existence
 * convention).
 *
 * v0.10.2 F3 — also appends a `flashcard_review_events` row for stats/leech
 * tracking, and suspends the card (sets `suspended_at`, appends 'leech' tag)
 * when the Again count reaches the workspace's `leech_threshold`.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = requireWorkspace(await getAuthContext());
    const parsed = Body.parse(await req.json());
    const db = getDb();

    const [card] = await db
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, parsed.cardId))
      .limit(1);
    if (!card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }
    if (card.workspaceId !== ctx.workspaceId) {
      // Same status as not-found to avoid leaking card existence cross-workspace.
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    const next = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.flashcardReviews)
        .where(
          and(
            eq(schema.flashcardReviews.cardId, parsed.cardId),
            eq(schema.flashcardReviews.userId, ctx.userId),
          ),
        )
        .limit(1)
        .for('update');
      const prev = existing
        ? { ease: existing.ease, interval: existing.interval }
        : { ease: 2.5, interval: 0 };
      const scheduled = scheduleNext(prev, parsed.grade);
      // v0.10.2 F1 — count every graded repetition (any grade, including
      // "Again"). New rows start at 1; existing rows increment in place.
      const reps = (existing?.reps ?? 0) + 1;
      await tx
        .insert(schema.flashcardReviews)
        .values({
          cardId: parsed.cardId,
          userId: ctx.userId,
          ease: scheduled.ease,
          interval: scheduled.interval,
          reps,
          dueAt: scheduled.dueAt,
          lastReviewedAt: scheduled.lastReviewedAt,
          lastGrade: scheduled.lastGrade,
        })
        .onConflictDoUpdate({
          target: [schema.flashcardReviews.cardId, schema.flashcardReviews.userId],
          set: {
            ease: scheduled.ease,
            interval: scheduled.interval,
            reps,
            dueAt: scheduled.dueAt,
            lastReviewedAt: scheduled.lastReviewedAt,
            lastGrade: scheduled.lastGrade,
            updatedAt: new Date(),
          },
        });

      // v0.10.2 F3 — append review event for stats / leech detection.
      const now = new Date();
      await tx.insert(schema.flashcardReviewEvents).values({
        cardId: parsed.cardId,
        userId: ctx.userId,
        grade: parsed.grade,
        reviewedAt: now,
      });

      // v0.10.2 F3 — leech check: only when grade is Again (0).
      if (parsed.grade === 0) {
        // Count how many Again events this (card, user) pair has accumulated
        // (including the one we just inserted).
        const againRows = await tx
          .select({ againCount: count() })
          .from(schema.flashcardReviewEvents)
          .where(
            and(
              eq(schema.flashcardReviewEvents.cardId, parsed.cardId),
              eq(schema.flashcardReviewEvents.userId, ctx.userId),
              eq(schema.flashcardReviewEvents.grade, 0),
            ),
          );
        const againCount = againRows[0]?.againCount ?? 0;

        const settings = await getWorkspaceFlashcardSettings(
          tx as Parameters<typeof getWorkspaceFlashcardSettings>[0],
          card.workspaceId,
        );
        const leechThreshold = settings.leechThreshold ?? 8;

        // Only suspend if not already suspended / leech-tagged.
        const alreadySuspended = card.suspendedAt !== null;
        const alreadyLeeched = card.tags.includes('leech');

        if (againCount >= leechThreshold && !alreadySuspended && !alreadyLeeched) {
          // Deduplicate tags — prepend 'leech' if not already present.
          const newTags = ['leech', ...card.tags.filter((t) => t !== 'leech')];
          await tx
            .update(schema.flashcardCards)
            .set({
              suspendedAt: now,
              tags: newTags,
              updatedAt: now,
            })
            .where(eq(schema.flashcardCards.id, parsed.cardId));

          await recordAudit(tx as Parameters<typeof recordAudit>[0], {
            workspaceId: card.workspaceId,
            actorUserId: ctx.userId,
            action: 'flashcard.card_leeched',
            targetType: 'flashcard_card',
            targetId: parsed.cardId,
            metadata: {
              cardId: parsed.cardId,
              againCount,
              leechThreshold,
            },
          });
        }
      }

      return scheduled;
    });
    return NextResponse.json({
      ok: true,
      dueAt: next.dueAt.toISOString(),
      ease: next.ease,
      interval: next.interval,
    });
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
