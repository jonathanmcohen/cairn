import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { suspendCards } from '@/lib/flashcards/manage';
import { stampOrphanedByCardIds } from '@/lib/flashcards/orphans';
import { countAllCards, getOverviewCounts, listRecentReviews } from '@/lib/flashcards/overview';
import { upsertCard } from '@/lib/flashcards/upsert-card';
import { createPage } from '@/lib/pages/create';
import { softDeletePage } from '@/lib/pages/delete';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

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
  await sql`TRUNCATE flashcard_reviews, flashcard_cards, flashcard_decks, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

const DAY = 86_400_000;

async function fixture() {
  const u = await createTestWorkspaceWithUser(db);
  const page = await createPage(db, {
    workspaceId: u.workspaceId,
    createdBy: u.userId,
    title: 'Source',
  });
  const mk = (blockId: string, front: string) =>
    upsertCard(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId,
      front,
      back: `A-${front}`,
      deckTag: null,
      createdBy: u.userId,
    });
  return { u, page, mk };
}

describe('flashcards overview — counts', () => {
  it('a brand-new card (no review row) counts as both due and new, not mature', async () => {
    const { u, mk } = await fixture();
    await mk('b1', 'fresh');
    const counts = await getOverviewCounts(db, u.workspaceId, u.userId);
    expect(counts).toEqual({ total: 1, due: 1, new: 1, mature: 0 });
  });

  it('a due, reviewed, short-interval card is due but not new and not mature', async () => {
    const { u, mk } = await fixture();
    const c = await mk('b1', 'short');
    await db.insert(schema.flashcardReviews).values({
      cardId: c.id,
      userId: u.userId,
      reps: 2,
      interval: 6,
      dueAt: new Date(Date.now() - DAY), // overdue
    });
    const counts = await getOverviewCounts(db, u.workspaceId, u.userId);
    expect(counts.total).toBe(1);
    expect(counts.due).toBe(1);
    expect(counts.new).toBe(0);
    expect(counts.mature).toBe(0);
  });

  it('counts a long-interval card as mature; a not-yet-due one is not due', async () => {
    const { u, mk } = await fixture();
    const c = await mk('b1', 'mature');
    await db.insert(schema.flashcardReviews).values({
      cardId: c.id,
      userId: u.userId,
      reps: 9,
      interval: 40, // >= 21 → mature
      dueAt: new Date(Date.now() + 30 * DAY), // future → not due
    });
    const counts = await getOverviewCounts(db, u.workspaceId, u.userId);
    expect(counts.total).toBe(1);
    expect(counts.due).toBe(0);
    expect(counts.new).toBe(0);
    expect(counts.mature).toBe(1);
  });

  it('an interval exactly at the 21-day boundary is mature', async () => {
    const { u, mk } = await fixture();
    const c = await mk('b1', 'boundary');
    await db.insert(schema.flashcardReviews).values({
      cardId: c.id,
      userId: u.userId,
      reps: 5,
      interval: 21,
      dueAt: new Date(Date.now() + DAY),
    });
    const counts = await getOverviewCounts(db, u.workspaceId, u.userId);
    expect(counts.mature).toBe(1);
  });

  it('orphaned, suspended, and trashed-source cards are excluded from every bucket', async () => {
    const { u, page, mk } = await fixture();
    const orphan = await mk('b1', 'orphan');
    const suspended = await mk('b2', 'suspended');
    const live = await mk('b3', 'live');
    await stampOrphanedByCardIds(db, [orphan.id]);
    await suspendCards(db, u.workspaceId, [suspended.id]);

    let counts = await getOverviewCounts(db, u.workspaceId, u.userId);
    // Only the live card is eligible.
    expect(counts.total).toBe(1);
    expect(counts.due).toBe(1);
    expect(counts.new).toBe(1);

    // Trash the source page → the live card also drops out (INNER JOIN on
    // pages.deleted_at IS NULL).
    await softDeletePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      actorUserId: u.userId,
      adminOverride: true,
    });
    counts = await getOverviewCounts(db, u.workspaceId, u.userId);
    expect(counts).toEqual({ total: 0, due: 0, new: 0, mature: 0 });
    void live;
  });

  it('counts are per-user: another member with no reviews sees the card as new/due', async () => {
    const { u, mk } = await fixture();
    const c = await mk('b1', 'shared');
    await db.insert(schema.flashcardReviews).values({
      cardId: c.id,
      userId: u.userId,
      reps: 9,
      interval: 40,
      dueAt: new Date(Date.now() + 30 * DAY),
    });
    // The owner sees it mature + not due.
    const owner = await getOverviewCounts(db, u.workspaceId, u.userId);
    expect(owner.mature).toBe(1);
    expect(owner.due).toBe(0);
    // A second user (no review row) sees it as a brand-new, due card.
    const [other] = await db
      .insert(schema.users)
      .values({ email: `other-${Date.now()}@t.test`, passwordHash: 'h', name: 'Other' })
      .returning({ id: schema.users.id });
    const other2 = await getOverviewCounts(db, u.workspaceId, other!.id);
    expect(other2.due).toBe(1);
    expect(other2.new).toBe(1);
    expect(other2.mature).toBe(0);
  });
});

describe('flashcards overview — recent activity', () => {
  it('lists the user’s most-recently-reviewed cards, newest first, with source page', async () => {
    const { u, mk } = await fixture();
    const a = await mk('b1', 'older');
    const b = await mk('b2', 'newer');
    const old = new Date(Date.now() - 2 * DAY);
    const recent = new Date(Date.now() - DAY);
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: a.id, userId: u.userId, reps: 1, lastReviewedAt: old, lastGrade: 2 });
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: b.id, userId: u.userId, reps: 1, lastReviewedAt: recent, lastGrade: 3 });

    const rows = await listRecentReviews(db, u.workspaceId, u.userId);
    expect(rows.map((r) => r.front)).toEqual(['newer', 'older']);
    expect(rows[0]!.pageTitle).toBe('Source');
    expect(rows[0]!.lastGrade).toBe(3);
  });

  it('excludes never-reviewed cards and respects the limit', async () => {
    const { u, mk } = await fixture();
    const reviewed = await mk('b1', 'reviewed');
    await mk('b2', 'never'); // no review row
    await db.insert(schema.flashcardReviews).values({
      cardId: reviewed.id,
      userId: u.userId,
      reps: 1,
      lastReviewedAt: new Date(),
      lastGrade: 2,
    });
    const rows = await listRecentReviews(db, u.workspaceId, u.userId, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.front).toBe('reviewed');
  });
});

describe('flashcards overview — countAllCards', () => {
  it('counts every card regardless of orphan/suspend state', async () => {
    const { u, mk } = await fixture();
    const o = await mk('b1', 'orphan');
    await mk('b2', 'live');
    await stampOrphanedByCardIds(db, [o.id]);
    expect(await countAllCards(db, u.workspaceId)).toBe(2);
    // Eligible (overview) count drops the orphan, but the raw total does not.
    const counts = await getOverviewCounts(db, u.workspaceId, u.userId);
    expect(counts.total).toBe(1);
  });
});
