import { and, count, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { upsertWorkspaceFlashcardSettings } from '@/lib/flashcards/settings';
import { upsertCard } from '@/lib/flashcards/upsert-card';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  process.env.DATABASE_URL = uri;
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE workspace_flashcard_settings, flashcard_review_events, flashcard_reviews, flashcard_cards, flashcard_decks, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

vi.mock('@/lib/auth/require-role', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/require-role')>('@/lib/auth/require-role');
  let ctx: { userId: string; workspaceId: string | null; role: schema.MemberRole | null } | null =
    null;
  return {
    ...actual,
    getAuthContext: async () => ctx,
    __set: (
      next: { userId: string; workspaceId: string | null; role: schema.MemberRole | null } | null,
    ) => {
      ctx = next;
    },
  };
});

async function setActor(
  c: { userId: string; workspaceId: string; role: schema.MemberRole } | null,
): Promise<void> {
  const mod = (await import('@/lib/auth/require-role')) as unknown as {
    __set: (
      c: { userId: string; workspaceId: string | null; role: schema.MemberRole | null } | null,
    ) => void;
  };
  mod.__set(c);
}

async function callGrade(body: unknown) {
  const mod = await import('@/app/api/flashcards/grade/route');
  const res = await mod.POST(
    new Request('http://localhost/api/flashcards/grade', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function callDue(deck?: string) {
  const mod = await import('@/app/api/flashcards/due/route');
  const url = `http://localhost/api/flashcards/due${deck ? `?deck=${encodeURIComponent(deck)}` : ''}`;
  const res = await mod.GET(new Request(url));
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('POST /api/flashcards/grade', () => {
  it('rejects unauthenticated', async () => {
    await setActor(null);
    const r = await callGrade({ cardId: '00000000-0000-0000-0000-000000000001', grade: 2 });
    expect(r.status).toBe(401);
  });

  it('writes a review row and advances due_at via SM-2 on first grade', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const card = await upsertCard(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: u.userId,
    });
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    const r = await callGrade({ cardId: card.id, grade: 2 });
    expect(r.status).toBe(200);

    const [row] = await getDb()
      .select()
      .from(schema.flashcardReviews)
      .where(
        and(
          eq(schema.flashcardReviews.cardId, card.id),
          eq(schema.flashcardReviews.userId, u.userId),
        ),
      );
    expect(row!.interval).toBe(1);
    expect(row!.dueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('updates an existing review row on subsequent grades', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const card = await upsertCard(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: u.userId,
    });
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    const r1 = await callGrade({ cardId: card.id, grade: 2 });
    expect(r1.status).toBe(200);
    const r2 = await callGrade({ cardId: card.id, grade: 2 });
    expect(r2.status).toBe(200);
    const rows = await getDb()
      .select()
      .from(schema.flashcardReviews)
      .where(
        and(
          eq(schema.flashcardReviews.cardId, card.id),
          eq(schema.flashcardReviews.userId, u.userId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.interval).toBe(6); // 1 → 6 on second successful review
  });

  it('handles concurrent grades atomically (no PK collision)', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const card = await upsertCard(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: u.userId,
    });
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => callGrade({ cardId: card.id, grade: 2 })),
    );
    for (const r of results) {
      expect(r.status).toBe(200);
    }
    const rows = await getDb()
      .select()
      .from(schema.flashcardReviews)
      .where(
        and(
          eq(schema.flashcardReviews.cardId, card.id),
          eq(schema.flashcardReviews.userId, u.userId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('returns 404 for a card in a different workspace', async () => {
    const a = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const b = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const pageA = await createPage(getDb(), {
      workspaceId: a.workspaceId,
      createdBy: a.userId,
      title: 'p',
    });
    const card = await upsertCard(getDb(), {
      pageId: pageA.id,
      workspaceId: a.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: a.userId,
    });
    // B is the actor.
    await setActor({ userId: b.userId, workspaceId: b.workspaceId, role: 'editor' });
    const r = await callGrade({ cardId: card.id, grade: 2 });
    expect(r.status).toBe(404);
  });

  it('rejects invalid grade values', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const card = await upsertCard(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: u.userId,
    });
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    const r = await callGrade({ cardId: card.id, grade: 7 });
    expect(r.status).toBe(400);
  });
});

// ─── v0.10.2 F3 — review events + leech detection ───────────────────────────

describe('POST /api/flashcards/grade — F3 review events', () => {
  it('appends a flashcard_review_event row on each grade', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const card = await upsertCard(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: u.userId,
    });
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });

    // Grade twice.
    await callGrade({ cardId: card.id, grade: 2 });
    await callGrade({ cardId: card.id, grade: 1 });

    const countRows = await getDb()
      .select({ total: count() })
      .from(schema.flashcardReviewEvents)
      .where(
        and(
          eq(schema.flashcardReviewEvents.cardId, card.id),
          eq(schema.flashcardReviewEvents.userId, u.userId),
        ),
      );
    expect(countRows[0]?.total).toBe(2);
  });

  it('records the correct grade value in the event', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const card = await upsertCard(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: u.userId,
    });
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    await callGrade({ cardId: card.id, grade: 0 }); // Again

    const events = await getDb()
      .select()
      .from(schema.flashcardReviewEvents)
      .where(
        and(
          eq(schema.flashcardReviewEvents.cardId, card.id),
          eq(schema.flashcardReviewEvents.userId, u.userId),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.grade).toBe(0);
  });
});

describe('POST /api/flashcards/grade — F3 leech detection', () => {
  async function makeCard(u: { workspaceId: string; userId: string; role: schema.MemberRole }) {
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'leech-p',
    });
    return upsertCard(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'leech-b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: u.userId,
    });
  }

  it('suspends card + adds leech tag when Again count reaches leech_threshold', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const THRESHOLD = 3;
    await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, {
      leechThreshold: THRESHOLD,
    });
    const card = await makeCard(u);
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });

    // Grade Again THRESHOLD times.
    for (let i = 0; i < THRESHOLD; i++) {
      const r = await callGrade({ cardId: card.id, grade: 0 });
      expect(r.status).toBe(200);
    }

    const [updated] = await getDb()
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, card.id));

    expect(updated?.suspendedAt).not.toBeNull();
    expect(updated?.tags).toContain('leech');
  });

  it('emits a flashcard.card_leeched audit row on suspension', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const THRESHOLD = 2;
    await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, {
      leechThreshold: THRESHOLD,
    });
    const card = await makeCard(u);
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });

    for (let i = 0; i < THRESHOLD; i++) {
      await callGrade({ cardId: card.id, grade: 0 });
    }

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'flashcard.card_leeched'),
          eq(schema.auditLog.targetId, card.id),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect((auditRows[0]?.metadata as Record<string, unknown>)?.cardId).toBe(card.id);
  });

  it('does NOT suspend when Again count is threshold - 1', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const THRESHOLD = 5;
    await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, {
      leechThreshold: THRESHOLD,
    });
    const card = await makeCard(u);
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });

    // Grade Again THRESHOLD - 1 times — should NOT suspend.
    for (let i = 0; i < THRESHOLD - 1; i++) {
      const r = await callGrade({ cardId: card.id, grade: 0 });
      expect(r.status).toBe(200);
    }

    const [notSuspended] = await getDb()
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, card.id));

    expect(notSuspended?.suspendedAt).toBeNull();
    expect(notSuspended?.tags).not.toContain('leech');
  });

  it('does not double-suspend an already-suspended card', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const THRESHOLD = 2;
    await upsertWorkspaceFlashcardSettings(getDb(), u.workspaceId, {
      leechThreshold: THRESHOLD,
    });
    const card = await makeCard(u);
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });

    // Reach threshold — card gets suspended.
    for (let i = 0; i < THRESHOLD; i++) {
      await callGrade({ cardId: card.id, grade: 0 });
    }

    // Grade Again one more time — should NOT create a second audit row.
    await callGrade({ cardId: card.id, grade: 0 });

    const auditRows = await getDb()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'flashcard.card_leeched'),
          eq(schema.auditLog.targetId, card.id),
        ),
      );
    expect(auditRows).toHaveLength(1);
  });

  it('uses workspace default threshold (8) when no settings row exists', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const card = await makeCard(u);
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });

    // 7 Again grades — below default threshold of 8.
    for (let i = 0; i < 7; i++) {
      await callGrade({ cardId: card.id, grade: 0 });
    }

    const [notSuspended] = await getDb()
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, card.id));
    expect(notSuspended?.suspendedAt).toBeNull();

    // 8th Again — now at threshold, card should be suspended.
    await callGrade({ cardId: card.id, grade: 0 });

    const [suspended] = await getDb()
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, card.id));
    expect(suspended?.suspendedAt).not.toBeNull();
    expect(suspended?.tags).toContain('leech');
  });
});

describe('GET /api/flashcards/due', () => {
  it('rejects unauthenticated', async () => {
    await setActor(null);
    const r = await callDue();
    expect(r.status).toBe(401);
  });

  it('returns the active workspace due-queue', async () => {
    const u = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const page = await createPage(getDb(), {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    await upsertCard(getDb(), {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: 'spanish',
      createdBy: u.userId,
    });
    await setActor({ userId: u.userId, workspaceId: u.workspaceId, role: 'editor' });
    const r = await callDue();
    expect(r.status).toBe(200);
    expect(((r.body as { due: unknown[] }).due as unknown[]).length).toBe(1);
  });

  it('isolates due queue between workspaces', async () => {
    const a = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const b = await createTestWorkspaceWithUser(getDb(), { role: 'editor' });
    const pageA = await createPage(getDb(), {
      workspaceId: a.workspaceId,
      createdBy: a.userId,
      title: 'p',
    });
    await upsertCard(getDb(), {
      pageId: pageA.id,
      workspaceId: a.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: a.userId,
    });
    // Actor is in workspace B with no cards.
    await setActor({ userId: b.userId, workspaceId: b.workspaceId, role: 'editor' });
    const r = await callDue();
    expect(r.status).toBe(200);
    expect(((r.body as { due: unknown[] }).due as unknown[]).length).toBe(0);
  });
});
