/**
 * v0.10.2 F2 Task D — reconcile inversion: the flashcard CARD is canonical and
 * the editor block is a reference carrying a `cardId`. Testcontainers Postgres.
 *
 * Covers, for BOTH write paths (REST `updatePage` → reconcileFlashcards and the
 * collab `reconcileFlashcardsRaw`):
 *   - a block WITH a cardId resolves + writes front/back to THAT card without
 *     re-minting;
 *   - a block WITHOUT a cardId mints a card and BACKFILLS the cardId into the
 *     persisted content;
 *   - CONVERGENCE: a second reconcile mints nothing and reports no content
 *     change;
 *   - the `deckId` hint sets a brand-new card's deck;
 *   - the block's deck attr does NOT overwrite an existing card's deck;
 *   - legacy (page_id, block_id) adoption backfills cardId;
 *   - orphan-mark still fires when a block disappears.
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDeck, ensureDefaultDeck } from '@/lib/flashcards/decks';
import { extractFlashcardBlocks } from '@/lib/flashcards/extract';
import { reconcileFlashcardsRaw } from '@/lib/flashcards/reconcile-raw';
import { createPage } from '@/lib/pages/create';
import { updatePage } from '@/lib/pages/update';
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
  await sql`TRUNCATE audit_log, flashcard_reviews, flashcard_cards, flashcard_decks, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

function fcard(attrs: Record<string, unknown>) {
  return { type: 'flashcard', attrs };
}
function docOf(...cards: Array<Record<string, unknown>>) {
  return { type: 'doc', content: cards.map((a) => fcard(a)) };
}

async function setup() {
  const u = await createTestWorkspaceWithUser(db);
  const page = await createPage(db, {
    workspaceId: u.workspaceId,
    createdBy: u.userId,
    title: 'p',
  });
  return { u, page };
}

async function save(pageId: string, workspaceId: string, userId: string, content: unknown) {
  await updatePage(db, {
    pageId,
    workspaceId,
    patch: { content },
    byUserId: userId,
    adminOverride: false,
  });
}

// Read the stored page content back (the REST path re-persists backfilled ids).
async function readContent(pageId: string): Promise<unknown> {
  const [pg] = await db
    .select({ content: schema.pages.content })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId));
  return pg?.content;
}

function blockAttrs(content: unknown, blockId: string): Record<string, unknown> | undefined {
  return extractFlashcardBlocks(content).length
    ? (content as { content: { type: string; attrs?: Record<string, unknown> }[] }).content.find(
        (n) => n.type === 'flashcard' && n.attrs?.blockId === blockId,
      )?.attrs
    : undefined;
}

describe('reconcile (REST path) — cardId inversion', () => {
  it('mints a card and backfills the cardId into the persisted + returned content', async () => {
    const { u, page } = await setup();
    await save(page.id, u.workspaceId, u.userId, docOf({ blockId: 'b1', front: 'Q', back: 'A' }));

    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    const cardId = cards[0]!.id;
    // The persisted content gained the cardId on the matching block.
    const attrs = blockAttrs(await readContent(page.id), 'b1');
    expect(attrs?.cardId).toBe(cardId);
  });

  it('a block WITH a cardId resolves THAT card and writes front/back without re-minting', async () => {
    const { u, page } = await setup();
    // First save mints + backfills.
    await save(page.id, u.workspaceId, u.userId, docOf({ blockId: 'b1', front: 'Q', back: 'A' }));
    const cardId = (await db.select().from(schema.flashcardCards))[0]!.id;

    // Edit the block's front/back; the block now carries the cardId.
    await save(
      page.id,
      u.workspaceId,
      u.userId,
      docOf({ blockId: 'b1', front: 'Q2', back: 'A2', cardId }),
    );

    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1); // no re-mint
    expect(cards[0]!.id).toBe(cardId);
    expect(cards[0]!.front).toBe('Q2');
    expect(cards[0]!.back).toBe('A2');
  });

  it('converges: re-saving the same backfilled content mints nothing and changes nothing', async () => {
    const { u, page } = await setup();
    await save(page.id, u.workspaceId, u.userId, docOf({ blockId: 'b1', front: 'Q', back: 'A' }));
    const persisted = await readContent(page.id);
    const cardCountAfterFirst = (await db.select().from(schema.flashcardCards)).length;
    expect(cardCountAfterFirst).toBe(1);

    // Re-save the persisted (already-backfilled) content twice more.
    await save(page.id, u.workspaceId, u.userId, persisted);
    await save(page.id, u.workspaceId, u.userId, await readContent(page.id));

    expect(await db.select().from(schema.flashcardCards)).toHaveLength(1);
  });

  it('uses the deckId hint for a brand-new card', async () => {
    const { u, page } = await setup();
    const deck = await createDeck(db, u.workspaceId, 'Verbs');
    await save(
      page.id,
      u.workspaceId,
      u.userId,
      docOf({ blockId: 'b1', front: 'Q', back: 'A', deckId: deck.id }),
    );
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.deckId).toBe(deck.id);
  });

  it('falls back to the Default deck when there is no deckId hint', async () => {
    const { u, page } = await setup();
    const def = await ensureDefaultDeck(db, u.workspaceId);
    await save(page.id, u.workspaceId, u.userId, docOf({ blockId: 'b1', front: 'Q', back: 'A' }));
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards[0]!.deckId).toBe(def.id);
  });

  it('does NOT overwrite an existing card deck when the block deck attr differs', async () => {
    const { u, page } = await setup();
    const deckA = await createDeck(db, u.workspaceId, 'A');
    const deckB = await createDeck(db, u.workspaceId, 'B');
    // New card in deck A (via hint).
    await save(
      page.id,
      u.workspaceId,
      u.userId,
      docOf({ blockId: 'b1', front: 'Q', back: 'A', deckId: deckA.id }),
    );
    const cardId = (await db.select().from(schema.flashcardCards))[0]!.id;
    expect((await db.select().from(schema.flashcardCards))[0]!.deckId).toBe(deckA.id);

    // Re-save with a DIFFERENT block deck hint AND the cardId — deck must stay A.
    await save(
      page.id,
      u.workspaceId,
      u.userId,
      docOf({ blockId: 'b1', front: 'Q', back: 'A', cardId, deckId: deckB.id }),
    );
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.deckId).toBe(deckA.id);
  });

  it('orphan-marks (not deletes) a card whose block vanished', async () => {
    const { u, page } = await setup();
    await save(page.id, u.workspaceId, u.userId, docOf({ blockId: 'b1', front: 'Q', back: 'A' }));
    const card = (await db.select().from(schema.flashcardCards))[0]!;
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: card.id, userId: u.userId, ease: 2.3, interval: 6, reps: 4 });

    await save(page.id, u.workspaceId, u.userId, { type: 'doc', content: [] });

    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.sourceOrphanedAt).not.toBeNull();
    const reviews = await db.select().from(schema.flashcardReviews);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.reps).toBe(4);
  });

  it('re-adds a vanished-then-returned block by reference, clearing the orphan flag', async () => {
    const { u, page } = await setup();
    await save(page.id, u.workspaceId, u.userId, docOf({ blockId: 'b1', front: 'Q', back: 'A' }));
    const cardId = (await db.select().from(schema.flashcardCards))[0]!.id;
    // Block removed → orphaned.
    await save(page.id, u.workspaceId, u.userId, { type: 'doc', content: [] });
    expect((await db.select().from(schema.flashcardCards))[0]!.sourceOrphanedAt).not.toBeNull();
    // Block returns carrying its cardId → resolves the same card, un-orphaned.
    await save(
      page.id,
      u.workspaceId,
      u.userId,
      docOf({ blockId: 'b1', front: 'Q', back: 'A', cardId }),
    );
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.id).toBe(cardId);
    expect(cards[0]!.sourceOrphanedAt).toBeNull();
  });
});

describe('reconcileFlashcardsRaw (collab path) — cardId inversion', () => {
  // The collab path writes pages.content first, then reconciles + re-persists.
  async function materialize(
    pageId: string,
    content: unknown,
  ): Promise<{ contentChanged: boolean }> {
    const json = JSON.stringify(content);
    await sql`UPDATE pages SET content = ${json}::jsonb, updated_at = now() WHERE id = ${pageId}`;
    return reconcileFlashcardsRaw(sql, { pageId, content });
  }

  it('mints a card, backfills cardId into pages.content, and converges', async () => {
    const { page } = await setup();
    const content = docOf({ blockId: 'b1', front: 'Q', back: 'A' });
    const r1 = await materialize(page.id, content);
    expect(r1.contentChanged).toBe(true);

    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    const cardId = cards[0]!.id;
    expect(blockAttrs(await readContent(page.id), 'b1')?.cardId).toBe(cardId);
    expect(cards[0]!.deckId).not.toBeNull(); // Default deck assigned

    // Convergence — the in-place stamped `content` now carries the cardId.
    const r2 = await reconcileFlashcardsRaw(sql, { pageId: page.id, content });
    expect(r2.contentChanged).toBe(false);
    expect(await db.select().from(schema.flashcardCards)).toHaveLength(1);
  });

  it('a block WITH a cardId writes front/back to THAT card without re-minting', async () => {
    const { page } = await setup();
    const first = docOf({ blockId: 'b1', front: 'Q', back: 'A' });
    await materialize(page.id, first);
    const cardId = (await db.select().from(schema.flashcardCards))[0]!.id;

    await materialize(page.id, docOf({ blockId: 'b1', front: 'Q9', back: 'A9', cardId }));
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.id).toBe(cardId);
    expect(cards[0]!.front).toBe('Q9');
  });

  it('legacy (page_id, block_id) row is adopted and gets its cardId backfilled', async () => {
    const { u, page } = await setup();
    const def = await ensureDefaultDeck(db, u.workspaceId);
    // Simulate a pre-F2 card row: page_id + block_id, no cardId in content.
    const [legacy] = await db
      .insert(schema.flashcardCards)
      .values({
        pageId: page.id,
        workspaceId: u.workspaceId,
        blockId: 'b1',
        front: 'old',
        back: 'oldA',
        deckId: def.id,
        createdBy: u.userId,
      })
      .returning();

    const content = docOf({ blockId: 'b1', front: 'new', back: 'newA' });
    const r = await materialize(page.id, content);
    expect(r.contentChanged).toBe(true);

    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1); // adopted, not duplicated
    expect(cards[0]!.id).toBe(legacy!.id);
    expect(cards[0]!.front).toBe('new');
    expect(blockAttrs(await readContent(page.id), 'b1')?.cardId).toBe(legacy!.id);
  });

  it('orphan-marks a card whose block vanished (collab path)', async () => {
    const { page } = await setup();
    await materialize(page.id, docOf({ blockId: 'b1', front: 'Q', back: 'A' }));
    await materialize(page.id, { type: 'doc', content: [] });
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.sourceOrphanedAt).not.toBeNull();
  });

  it('a cardId that does not resolve in-workspace falls back to legacy/mint (no silent drop)', async () => {
    const { u, page } = await setup();
    // Block references a non-existent cardId — must still produce a card.
    const bogus = '00000000-0000-0000-0000-0000000000aa';
    const content = docOf({ blockId: 'b1', front: 'Q', back: 'A', cardId: bogus });
    const r = await materialize(page.id, content);
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.id).not.toBe(bogus);
    expect(cards[0]!.workspaceId).toBe(u.workspaceId);
    // The block is re-stamped with the real (minted) card id.
    expect(r.contentChanged).toBe(true);
    expect(blockAttrs(await readContent(page.id), 'b1')?.cardId).toBe(cards[0]!.id);
  });
});
