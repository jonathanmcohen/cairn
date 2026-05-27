import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext, HttpError, requireWorkspace } from '@/lib/auth/require-role';
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

    const [existing] = await db
      .select()
      .from(schema.flashcardReviews)
      .where(
        and(
          eq(schema.flashcardReviews.cardId, parsed.cardId),
          eq(schema.flashcardReviews.userId, ctx.userId),
        ),
      )
      .limit(1);
    const prev = existing
      ? { ease: existing.ease, interval: existing.interval }
      : { ease: 2.5, interval: 0 };
    const next = scheduleNext(prev, parsed.grade);

    if (existing) {
      await db
        .update(schema.flashcardReviews)
        .set({
          ease: next.ease,
          interval: next.interval,
          dueAt: next.dueAt,
          lastReviewedAt: next.lastReviewedAt,
          lastGrade: next.lastGrade,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.flashcardReviews.cardId, parsed.cardId),
            eq(schema.flashcardReviews.userId, ctx.userId),
          ),
        );
    } else {
      await db.insert(schema.flashcardReviews).values({
        cardId: parsed.cardId,
        userId: ctx.userId,
        ease: next.ease,
        interval: next.interval,
        dueAt: next.dueAt,
        lastReviewedAt: next.lastReviewedAt,
        lastGrade: next.lastGrade,
      });
    }
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
