import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDeck } from '@/lib/flashcards/decks';
import {
  addTags,
  deleteCards,
  listCards,
  moveToDeck,
  removeTags,
  resetSm2,
  suspendCards,
  unsuspendCards,
} from '@/lib/flashcards/manage';
import { upsertCard } from '@/lib/flashcards/upsert-card';
import { createPage } from '@/lib/pages/create';
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

describe('flashcards manage — list filters', () => {
  it('lists cards with deck name, source page title, and derived state (new)', async () => {
    const { u, mk } = await fixture();
    await mk('b1', 'hola');
    const cards = await listCards(db, u.workspaceId, u.userId);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.pageTitle).toBe('Source');
    expect(cards[0]!.state).toBe('new');
    expect(cards[0]!.reps).toBe(0);
  });

  it('filters by deck', async () => {
    const { u, mk } = await fixture();
    const deck = await createDeck(db, u.workspaceId, 'D1');
    const c1 = await mk('b1', 'in-deck');
    await mk('b2', 'no-deck');
    await moveToDeck(db, u.workspaceId, [c1.id], deck.id);
    const inDeck = await listCards(db, u.workspaceId, u.userId, { deckId: deck.id });
    expect(inDeck).toHaveLength(1);
    expect(inDeck[0]!.front).toBe('in-deck');
    expect(inDeck[0]!.deckName).toBe('D1');
  });

  it('filters by tag', async () => {
    const { u, mk } = await fixture();
    const c1 = await mk('b1', 'tagged');
    await mk('b2', 'untagged');
    await addTags(db, u.workspaceId, [c1.id], ['verb']);
    const tagged = await listCards(db, u.workspaceId, u.userId, { tag: 'verb' });
    expect(tagged.map((c) => c.front)).toEqual(['tagged']);
  });

  it('filters by search across front and back', async () => {
    const { u, mk } = await fixture();
    await mk('b1', 'apple');
    await mk('b2', 'banana');
    const r = await listCards(db, u.workspaceId, u.userId, { search: 'A-banana' });
    expect(r.map((c) => c.front)).toEqual(['banana']);
  });

  it('filters by state: suspended', async () => {
    const { u, mk } = await fixture();
    const c1 = await mk('b1', 'live');
    const c2 = await mk('b2', 'held');
    await suspendCards(db, u.workspaceId, [c2.id]);
    const suspended = await listCards(db, u.workspaceId, u.userId, { state: 'suspended' });
    expect(suspended.map((c) => c.front)).toEqual(['held']);
    expect(suspended[0]!.state).toBe('suspended');
    // c1 is still 'new'
    const news = await listCards(db, u.workspaceId, u.userId, { state: 'new' });
    expect(news.map((c) => c.id)).toContain(c1.id);
  });

  it('filters by state: learning vs review (interval threshold)', async () => {
    const { u, mk } = await fixture();
    const cl = await mk('b1', 'learning');
    const cr = await mk('b2', 'review');
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: cl.id, userId: u.userId, reps: 2, interval: 6 });
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: cr.id, userId: u.userId, reps: 5, interval: 40 });
    const learning = await listCards(db, u.workspaceId, u.userId, { state: 'learning' });
    expect(learning.map((c) => c.front)).toEqual(['learning']);
    const review = await listCards(db, u.workspaceId, u.userId, { state: 'review' });
    expect(review.map((c) => c.front)).toEqual(['review']);
  });

  it('filters by source-page-exists / orphaned', async () => {
    const { u, mk } = await fixture();
    const c1 = await mk('b1', 'attached');
    const c2 = await mk('b2', 'orphan');
    await db
      .update(schema.flashcardCards)
      .set({ sourceOrphanedAt: new Date() })
      .where(eq(schema.flashcardCards.id, c2.id));
    const attached = await listCards(db, u.workspaceId, u.userId, { sourcePageExists: true });
    expect(attached.map((c) => c.id)).toEqual([c1.id]);
    const orphaned = await listCards(db, u.workspaceId, u.userId, { sourcePageExists: false });
    expect(orphaned.map((c) => c.id)).toEqual([c2.id]);
  });
});

describe('flashcards manage — mutations', () => {
  it('add/remove tags are bulk + de-duped', async () => {
    const { u, mk } = await fixture();
    const c1 = await mk('b1', 'one');
    const c2 = await mk('b2', 'two');
    await addTags(db, u.workspaceId, [c1.id, c2.id], ['x', 'y', 'x']);
    await addTags(db, u.workspaceId, [c1.id], ['x', 'z']); // x already present
    const rows = await listCards(db, u.workspaceId, u.userId);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.tags.slice().sort()]));
    expect(byId[c1.id]).toEqual(['x', 'y', 'z']);
    expect(byId[c2.id]).toEqual(['x', 'y']);

    await removeTags(db, u.workspaceId, [c1.id], ['x']);
    const after = await listCards(db, u.workspaceId, u.userId, { deckId: undefined });
    const c1after = after.find((r) => r.id === c1.id);
    expect(c1after!.tags.slice().sort()).toEqual(['y', 'z']);
  });

  it('suspend is idempotent and unsuspend clears', async () => {
    const { u, mk } = await fixture();
    const c = await mk('b1', 'q');
    expect(await suspendCards(db, u.workspaceId, [c.id])).toBe(1);
    expect(await suspendCards(db, u.workspaceId, [c.id])).toBe(0); // already suspended
    expect(await unsuspendCards(db, u.workspaceId, [c.id])).toBe(1);
    const [row] = await listCards(db, u.workspaceId, u.userId);
    expect(row!.suspendedAt).toBeNull();
  });

  it('resetSm2 resets ease/interval/reps/due for the user', async () => {
    const { u, mk } = await fixture();
    const c = await mk('b1', 'q');
    await db.insert(schema.flashcardReviews).values({
      cardId: c.id,
      userId: u.userId,
      ease: 1.8,
      interval: 30,
      reps: 9,
      dueAt: new Date(Date.now() + 30 * 86_400_000),
    });
    const n = await resetSm2(db, u.workspaceId, u.userId, [c.id]);
    expect(n).toBe(1);
    const [rev] = await db
      .select()
      .from(schema.flashcardReviews)
      .where(eq(schema.flashcardReviews.cardId, c.id));
    expect(rev!.ease).toBeCloseTo(2.5);
    expect(rev!.interval).toBe(0);
    expect(rev!.reps).toBe(0);
  });

  it('moveToDeck and deleteCards are workspace-scoped', async () => {
    const { u, mk } = await fixture();
    const other = await createTestWorkspaceWithUser(db);
    const c = await mk('b1', 'mine');
    // Attempting to delete a card from another workspace's scope is a no-op.
    expect(await deleteCards(db, other.workspaceId, [c.id])).toBe(0);
    expect(await deleteCards(db, u.workspaceId, [c.id])).toBe(1);
  });
});
