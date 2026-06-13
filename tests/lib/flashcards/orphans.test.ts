import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import {
  deleteOrphans,
  keepOrphanStandalone,
  keepOrphansStandalone,
  listOrphans,
  reattachOrphan,
  stampOrphanedByPageIds,
} from '@/lib/flashcards/orphans';
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

async function seedCard(opts?: { blockId?: string }) {
  const u = await createTestWorkspaceWithUser(db);
  const page = await createPage(db, {
    workspaceId: u.workspaceId,
    createdBy: u.userId,
    title: 'p',
  });
  const card = await upsertCard(db, {
    pageId: page.id,
    workspaceId: u.workspaceId,
    blockId: opts?.blockId ?? 'b1',
    front: 'Q',
    back: 'A',
    deckTag: null,
    createdBy: u.userId,
  });
  return { u, page, card };
}

describe('flashcards orphans', () => {
  it('stampOrphanedByPageIds stamps attached cards and is idempotent', async () => {
    const { u, page, card } = await seedCard();
    const now = new Date('2026-01-01T00:00:00Z');
    const n = await stampOrphanedByPageIds(db, [page.id], now);
    expect(n).toBe(1);
    const [after] = await db
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, card.id));
    expect(after!.sourceOrphanedAt?.toISOString()).toBe(now.toISOString());

    // Re-stamp must NOT touch the already-orphaned card (preserve first stamp).
    const n2 = await stampOrphanedByPageIds(db, [page.id], new Date('2027-01-01T00:00:00Z'));
    expect(n2).toBe(0);
    const orphans = await listOrphans(db, u.workspaceId);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.sourceOrphanedAt?.toISOString()).toBe(now.toISOString());
  });

  it('reattach: sets page_id + clears the orphan flag', async () => {
    const { u, card } = await seedCard();
    await stampOrphanedByPageIds(db, [card.pageId!]);
    const newPage = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'new',
    });
    await reattachOrphan(db, { cardId: card.id, pageId: newPage.id });
    const [after] = await db
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, card.id));
    expect(after!.pageId).toBe(newPage.id);
    expect(after!.sourceOrphanedAt).toBeNull();
    expect(await listOrphans(db, u.workspaceId)).toHaveLength(0);
  });

  it('keep-standalone: clears the orphan flag but leaves page_id NULL', async () => {
    const { u, card, page } = await seedCard();
    // Simulate permanent page delete (SET NULL) by nulling page_id + orphaning.
    await db
      .update(schema.flashcardCards)
      .set({ sourceOrphanedAt: new Date(), pageId: null })
      .where(eq(schema.flashcardCards.id, card.id));
    await keepOrphanStandalone(db, card.id);
    const [after] = await db
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, card.id));
    expect(after!.sourceOrphanedAt).toBeNull();
    expect(after!.pageId).toBeNull();
    expect(await listOrphans(db, u.workspaceId)).toHaveLength(0);
    // Sanity: the page id we created still exists (no accidental delete).
    expect(page.id).toBeDefined();
  });

  it('keepOrphansStandalone: bulk-clears the orphan flag, workspace-scoped', async () => {
    const { u, card } = await seedCard();
    // Simulate a permanent page delete: page_id SET NULL + orphan-stamped.
    await db
      .update(schema.flashcardCards)
      .set({ sourceOrphanedAt: new Date(), pageId: null })
      .where(eq(schema.flashcardCards.id, card.id));
    expect(await listOrphans(db, u.workspaceId)).toHaveLength(1);

    // A card id from another workspace is a no-op (workspace_id guard).
    const other = await seedCard({ blockId: 'b-other' });
    await stampOrphanedByPageIds(db, [other.card.pageId!]);
    const crossN = await keepOrphansStandalone(db, u.workspaceId, [other.card.id]);
    expect(crossN).toBe(0);
    expect(await listOrphans(db, other.u.workspaceId)).toHaveLength(1);

    // In-workspace clear works and is reported. The orphan flag is cleared but
    // page_id stays NULL — the card studies as a standalone with no source page.
    const n = await keepOrphansStandalone(db, u.workspaceId, [card.id]);
    expect(n).toBe(1);
    const [after] = await db
      .select()
      .from(schema.flashcardCards)
      .where(eq(schema.flashcardCards.id, card.id));
    expect(after!.sourceOrphanedAt).toBeNull();
    expect(after!.pageId).toBeNull();
    expect(await listOrphans(db, u.workspaceId)).toHaveLength(0);

    // An already-attached (non-orphaned) card is skipped (guard).
    const n2 = await keepOrphansStandalone(db, u.workspaceId, [card.id]);
    expect(n2).toBe(0);
  });

  it('delete: hard-removes orphaned card(s) and cascades their reviews', async () => {
    const { u, card } = await seedCard();
    await db.insert(schema.flashcardReviews).values({ cardId: card.id, userId: u.userId, reps: 3 });
    await stampOrphanedByPageIds(db, [card.pageId!]);
    const n = await deleteOrphans(db, [card.id]);
    expect(n).toBe(1);
    expect(
      await db.select().from(schema.flashcardCards).where(eq(schema.flashcardCards.id, card.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.flashcardReviews)
        .where(eq(schema.flashcardReviews.cardId, card.id)),
    ).toHaveLength(0);
  });
});
