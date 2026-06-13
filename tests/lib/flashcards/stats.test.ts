import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { getFlashcardStats } from '@/lib/flashcards/stats';
import { upsertCard } from '@/lib/flashcards/upsert-card';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

const DAY = 86_400_000;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE flashcard_review_events, flashcard_reviews, flashcard_cards, flashcard_decks, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fixture() {
  const u = await createTestWorkspaceWithUser(db);
  const page = await createPage(db, {
    workspaceId: u.workspaceId,
    createdBy: u.userId,
    title: 'Source',
  });
  const deck = await db
    .insert(schema.flashcardDecks)
    .values({ workspaceId: u.workspaceId, name: 'Default' })
    .returning({ id: schema.flashcardDecks.id });
  const deckId = deck[0]?.id;

  const mk = (blockId: string, front: string) =>
    upsertCard(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId,
      front,
      back: `A-${front}`,
      deckTag: null,
      createdBy: u.userId,
      deckId,
    });

  return { u, page, deckId, mk };
}

async function insertEvent(
  userId: string,
  cardId: string,
  grade: number,
  reviewedAt: Date,
): Promise<void> {
  await db.insert(schema.flashcardReviewEvents).values({ userId, cardId, grade, reviewedAt });
}

// ---------------------------------------------------------------------------
// Cold install
// ---------------------------------------------------------------------------

describe('cold install (no events, no cards)', () => {
  it('returns zeroed arrays and null retention without throwing', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const now = new Date('2025-06-01T12:00:00Z');
    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });

    expect(stats.retention).toEqual({ percent: null, total: 0 });
    expect(stats.maturity).toEqual({ new: 0, learning: 0, young: 0, mature: 0 });
    expect(stats.dailyReviews).toHaveLength(30);
    expect(stats.heatmap).toHaveLength(365);
    expect(stats.perDeck).toEqual([]);
    expect(stats.forecast.next30).toBe(0);
    expect(stats.forecast.days).toHaveLength(7);

    // All counts must be 0, no NaN
    for (const d of stats.dailyReviews) {
      expect(d.count).toBe(0);
      expect(Number.isNaN(d.count)).toBe(false);
    }
    for (const d of stats.heatmap) {
      expect(d.count).toBe(0);
    }
    for (const d of stats.forecast.days) {
      expect(d.count).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// dailyReviews
// ---------------------------------------------------------------------------

describe('dailyReviews', () => {
  it('returns exactly 30 entries oldest-first', async () => {
    const { u } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');
    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    expect(stats.dailyReviews).toHaveLength(30);
    // oldest entry is 30 days before yesterday
    expect(stats.dailyReviews[0]?.date).toBe('2025-05-16');
    // newest entry is yesterday
    expect(stats.dailyReviews[29]?.date).toBe('2025-06-14');
  });

  it('counts events per day, zero-fills missing days', async () => {
    const { u, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');
    const card = await mk('b1', 'card1');

    // 2 events on 2025-06-14
    await insertEvent(u.userId, card.id, 2, new Date('2025-06-14T08:00:00Z'));
    await insertEvent(u.userId, card.id, 3, new Date('2025-06-14T09:00:00Z'));
    // 1 event on 2025-06-10
    await insertEvent(u.userId, card.id, 1, new Date('2025-06-10T10:00:00Z'));

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    const byDate = Object.fromEntries(stats.dailyReviews.map((d) => [d.date, d.count]));
    expect(byDate['2025-06-14']).toBe(2);
    expect(byDate['2025-06-10']).toBe(1);
    // Other days are 0
    expect(byDate['2025-06-13']).toBe(0);
  });

  it('excludes events from other users', async () => {
    const { u, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');
    const card = await mk('b1', 'card1');

    const [other] = await db
      .insert(schema.users)
      .values({ email: 'other@example.com', passwordHash: 'h', name: 'Other' })
      .returning({ id: schema.users.id });

    if (!other) throw new Error('failed to insert other user');
    await insertEvent(other.id, card.id, 2, new Date('2025-06-14T08:00:00Z'));
    await insertEvent(u.userId, card.id, 3, new Date('2025-06-14T09:00:00Z'));

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    const byDate = Object.fromEntries(stats.dailyReviews.map((d) => [d.date, d.count]));
    expect(byDate['2025-06-14']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// retention
// ---------------------------------------------------------------------------

describe('retention', () => {
  it('returns 75 when 3 grade>=2 events and 1 grade=0 in the 30-day window', async () => {
    const { u, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');
    const card = await mk('b1', 'c1');

    // 3 Good/Easy in window
    await insertEvent(u.userId, card.id, 2, new Date('2025-06-14T08:00:00Z'));
    await insertEvent(u.userId, card.id, 2, new Date('2025-06-13T08:00:00Z'));
    await insertEvent(u.userId, card.id, 3, new Date('2025-06-12T08:00:00Z'));
    // 1 Again in window
    await insertEvent(u.userId, card.id, 0, new Date('2025-06-11T08:00:00Z'));

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    expect(stats.retention.percent).toBe(75);
    expect(stats.retention.total).toBe(4);
  });

  it('excludes events older than 30 days', async () => {
    const { u, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');
    const card = await mk('b1', 'c1');

    // 3 in-window
    await insertEvent(u.userId, card.id, 2, new Date('2025-06-14T08:00:00Z'));
    await insertEvent(u.userId, card.id, 2, new Date('2025-06-13T08:00:00Z'));
    await insertEvent(u.userId, card.id, 3, new Date('2025-06-12T08:00:00Z'));
    // 1 Again in window
    await insertEvent(u.userId, card.id, 0, new Date('2025-06-11T08:00:00Z'));
    // 1 out-of-window Easy event (31 days ago) — must NOT shift the retention %
    const outOfWindow = new Date(now.getTime() - 31 * DAY);
    await insertEvent(u.userId, card.id, 3, outOfWindow);

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    // Still 75% — the out-of-window event is excluded
    expect(stats.retention.percent).toBe(75);
    expect(stats.retention.total).toBe(4);
  });

  it('returns null percent and total 0 with no events in window', async () => {
    const { u } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');
    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    expect(stats.retention).toEqual({ percent: null, total: 0 });
  });
});

// ---------------------------------------------------------------------------
// maturity
// ---------------------------------------------------------------------------

describe('maturity', () => {
  it('buckets cards correctly: new/learning/young/mature', async () => {
    const { u, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');

    // new — no review row
    await mk('b1', 'new-card');
    // learning — interval=0
    const learning = await mk('b2', 'learning-card');
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: learning.id, userId: u.userId, interval: 0, reps: 1 });
    // young — interval=5
    const young = await mk('b3', 'young-card');
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: young.id, userId: u.userId, interval: 5, reps: 3 });
    // mature — interval=25
    const mature = await mk('b4', 'mature-card');
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: mature.id, userId: u.userId, interval: 25, reps: 10 });

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    expect(stats.maturity).toEqual({ new: 1, learning: 1, young: 1, mature: 1 });
  });

  it('interval boundary: 20 is young, 21 is mature', async () => {
    const { u, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');

    const c20 = await mk('b1', 'young-boundary');
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: c20.id, userId: u.userId, interval: 20 });
    const c21 = await mk('b2', 'mature-boundary');
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: c21.id, userId: u.userId, interval: 21 });

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    expect(stats.maturity.young).toBe(1);
    expect(stats.maturity.mature).toBe(1);
  });

  it('excludes suspended and orphaned cards from all buckets', async () => {
    const { u, page, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');

    // suspended
    const susp = await mk('b1', 'susp');
    await sql`UPDATE flashcard_cards SET suspended_at = NOW() WHERE id = ${susp.id}`;
    // orphaned
    const orphan = await mk('b2', 'orphan');
    await sql`UPDATE flashcard_cards SET source_orphaned_at = NOW() WHERE id = ${orphan.id}`;
    // live card
    await mk('b3', 'live');

    void page;

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    const total =
      stats.maturity.new + stats.maturity.learning + stats.maturity.young + stats.maturity.mature;
    expect(total).toBe(1);
    expect(stats.maturity.new).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// heatmap
// ---------------------------------------------------------------------------

describe('heatmap', () => {
  it('returns exactly 365 entries', async () => {
    const { u } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');
    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    expect(stats.heatmap).toHaveLength(365);
  });

  it('counts events per day in the heatmap', async () => {
    const { u, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');
    const card = await mk('b1', 'c1');

    await insertEvent(u.userId, card.id, 2, new Date('2025-06-14T08:00:00Z'));
    await insertEvent(u.userId, card.id, 2, new Date('2025-06-14T09:00:00Z'));

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    const cell = stats.heatmap.find((d) => d.date === '2025-06-14');
    expect(cell?.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// forecast
// ---------------------------------------------------------------------------

describe('forecast', () => {
  it('returns 7 days and counts cards due by offset', async () => {
    const { u, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');

    const c1 = await mk('b1', 'due-today');
    const c2 = await mk('b2', 'due-tomorrow');
    const c3 = await mk('b3', 'overdue');

    // c1 due exactly at now (today bucket = offset 0)
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: c1.id, userId: u.userId, dueAt: now });
    // c2 due 1 day from now
    await db.insert(schema.flashcardReviews).values({
      cardId: c2.id,
      userId: u.userId,
      dueAt: new Date(now.getTime() + DAY),
    });
    // c3 overdue → offset 0
    await db.insert(schema.flashcardReviews).values({
      cardId: c3.id,
      userId: u.userId,
      dueAt: new Date(now.getTime() - 2 * DAY),
    });

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    expect(stats.forecast.days).toHaveLength(7);
    // offset 0 = c1 (due at now) + c3 (overdue) + brand new card b1 which has no review row
    // Wait — mk('b1') is c1, etc. c1 is due at now, c3 overdue, and there's actually a 4th
    // card with no review row (brand new) if we made it.
    // Let me reconsider: c1, c2, c3 all have review rows; no review-row card ('b1' is c1 with review row).
    // Actually b3=c3 is overdue, b1=c1 is due at now. b2=c2 is due in 1 day.
    // No cards without review rows. So offset 0 = c1 + c3 = 2, offset 1 = c2 = 1
    expect(stats.forecast.days[0]?.count).toBe(2); // c1 (due=now) + c3 (overdue)
    expect(stats.forecast.days[1]?.count).toBe(1); // c2 (due tomorrow)
    expect(stats.forecast.next30).toBe(3); // all 3 within 30d
  });

  it('includes brand-new cards (no review row) in offset 0', async () => {
    const { u, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');
    // No review row → immediately due → offset 0
    await mk('b1', 'new-card');

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    expect(stats.forecast.days[0]?.count).toBe(1);
    expect(stats.forecast.next30).toBe(1);
  });

  it('excludes suspended and orphaned cards from forecast', async () => {
    const { u, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');

    const live = await mk('b1', 'live');
    const susp = await mk('b2', 'susp');
    await sql`UPDATE flashcard_cards SET suspended_at = NOW() WHERE id = ${susp.id}`;
    const orphan = await mk('b3', 'orphan');
    await sql`UPDATE flashcard_cards SET source_orphaned_at = NOW() WHERE id = ${orphan.id}`;

    void live;

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    // Only the live card (brand new → offset 0)
    expect(stats.forecast.next30).toBe(1);
  });

  it('excludes cards due beyond 30 days from next30', async () => {
    const { u, mk } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');

    const near = await mk('b1', 'near');
    const far = await mk('b2', 'far');
    await db.insert(schema.flashcardReviews).values({
      cardId: near.id,
      userId: u.userId,
      dueAt: new Date(now.getTime() + 5 * DAY),
    });
    await db.insert(schema.flashcardReviews).values({
      cardId: far.id,
      userId: u.userId,
      dueAt: new Date(now.getTime() + 31 * DAY), // beyond 30d
    });

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    expect(stats.forecast.next30).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// perDeck
// ---------------------------------------------------------------------------

describe('perDeck', () => {
  it('returns review count and retention per deck', async () => {
    const { u, mk, deckId } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');

    const c1 = await mk('b1', 'c1');
    const c2 = await mk('b2', 'c2');

    // c1: 2 good events
    await insertEvent(u.userId, c1.id, 2, new Date('2025-06-14T08:00:00Z'));
    await insertEvent(u.userId, c1.id, 3, new Date('2025-06-13T08:00:00Z'));
    // c2: 1 good, 1 again
    await insertEvent(u.userId, c2.id, 2, new Date('2025-06-12T08:00:00Z'));
    await insertEvent(u.userId, c2.id, 0, new Date('2025-06-11T08:00:00Z'));

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    const deck = stats.perDeck.find((d) => d.deckId === deckId);
    expect(deck).toBeDefined();
    expect(deck?.reviews).toBe(4);
    // 3 good out of 4 = 75%
    expect(deck?.retentionPercent).toBe(75);

    void c1;
    void c2;
  });

  it('returns retentionPercent null when deck has 0 in-window reviews', async () => {
    const { u, deckId } = await fixture();
    const now = new Date('2025-06-15T12:00:00Z');
    // A card in the deck but no events → 0 reviews
    await upsertCard(db, {
      pageId: (
        await createPage(db, { workspaceId: u.workspaceId, createdBy: u.userId, title: 'P2' })
      ).id,
      workspaceId: u.workspaceId,
      blockId: 'b-empty',
      front: 'empty',
      back: 'empty',
      deckTag: null,
      createdBy: u.userId,
      deckId,
    });

    const stats = await getFlashcardStats(db, {
      userId: u.userId,
      workspaceId: u.workspaceId,
      now,
    });
    const deck = stats.perDeck.find((d) => d.deckId === deckId);
    expect(deck).toBeDefined();
    expect(deck?.reviews).toBe(0);
    expect(deck?.retentionPercent).toBeNull();
  });
});
