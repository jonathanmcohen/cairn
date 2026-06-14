import { Buffer } from 'node:buffer';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import unzipper from 'unzipper';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { buildApkg } from '@/lib/flashcards/apkg';
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

/** Read a single named entry from a ZIP buffer into a Buffer. */
async function readZipEntry(zip: Uint8Array, name: string): Promise<Buffer> {
  const dir = await unzipper.Open.buffer(Buffer.from(zip));
  const file = dir.files.find((f) => f.path === name);
  if (!file) throw new Error(`entry not found: ${name} (have ${dir.files.map((f) => f.path)})`);
  return file.buffer();
}

/** All entry names in a ZIP buffer. */
async function zipEntryNames(zip: Uint8Array): Promise<string[]> {
  const dir = await unzipper.Open.buffer(Buffer.from(zip));
  return dir.files.map((f) => f.path);
}

type Row = Record<string, number | string | Uint8Array | null>;

/** Open collection.anki2 bytes with sql.js and run a query → array of row objects. */
async function queryAnki(anki2: Buffer, query: string): Promise<Row[]> {
  const SQL = await initSqlJs();
  const adb: SqlJsDatabase = new SQL.Database(new Uint8Array(anki2));
  try {
    const res = adb.exec(query);
    if (res.length === 0) return [];
    const { columns, values } = res[0]!;
    return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as Row);
  } finally {
    adb.close();
  }
}

describe('flashcards .apkg export', () => {
  it('builds an importable .apkg with deck hierarchy, SM-2 mapping, suspended + orphan flags', async () => {
    const u = await createTestWorkspaceWithUser(db);

    // Deck tree: "Languages" → child "Spanish"; a sibling root deck "Geo".
    const [languages] = await db
      .insert(schema.flashcardDecks)
      .values({ workspaceId: u.workspaceId, name: 'Languages' })
      .returning();
    const [spanish] = await db
      .insert(schema.flashcardDecks)
      .values({ workspaceId: u.workspaceId, name: 'Spanish', parentDeckId: languages!.id })
      .returning();
    const [geo] = await db
      .insert(schema.flashcardDecks)
      .values({ workspaceId: u.workspaceId, name: 'Geo' })
      .returning();

    // 1) Graded review card (mapped to factor/ivl, type=2/queue=2).
    const [graded] = await db
      .insert(schema.flashcardCards)
      .values({
        workspaceId: u.workspaceId,
        blockId: 'b-graded',
        front: 'hola',
        back: 'hello',
        deckId: spanish!.id,
        createdBy: u.userId,
      })
      .returning();
    await db.insert(schema.flashcardReviews).values({
      cardId: graded!.id,
      userId: u.userId,
      ease: 2.5,
      interval: 30,
      reps: 4,
      lastGrade: 2,
    });

    // 2) Suspended card (queue = -1).
    const [suspended] = await db
      .insert(schema.flashcardCards)
      .values({
        workspaceId: u.workspaceId,
        blockId: 'b-suspended',
        front: 'adios',
        back: 'goodbye',
        deckId: spanish!.id,
        suspendedAt: new Date(),
        createdBy: u.userId,
      })
      .returning();
    await db.insert(schema.flashcardReviews).values({
      cardId: suspended!.id,
      userId: u.userId,
      ease: 2.3,
      interval: 12,
      reps: 2,
      lastGrade: 1,
    });

    // 3) Orphan card (sourceOrphanedAt set → cairn-orphan tag). New (no review row).
    const [orphan] = await db
      .insert(schema.flashcardCards)
      .values({
        workspaceId: u.workspaceId,
        blockId: 'b-orphan',
        front: 'capital of France',
        back: 'Paris',
        deckId: geo!.id,
        sourceOrphanedAt: new Date(),
        createdBy: u.userId,
      })
      .returning();

    // 4) New card under the root parent deck, no review row (type=0/queue=0).
    await db
      .insert(schema.flashcardCards)
      .values({
        workspaceId: u.workspaceId,
        blockId: 'b-new',
        front: 'uno',
        back: 'one',
        deckId: languages!.id,
        createdBy: u.userId,
      })
      .returning();

    const apkg = await buildApkg(db, { workspaceId: u.workspaceId, userId: u.userId });

    // ZIP shape: collection.anki2 + media.
    const names = await zipEntryNames(apkg);
    expect(names).toContain('collection.anki2');
    expect(names).toContain('media');
    expect((await readZipEntry(apkg, 'media')).toString('utf8')).toBe('{}');

    const anki2 = await readZipEntry(apkg, 'collection.anki2');

    // Core tables exist.
    const tables = (
      await queryAnki(anki2, "SELECT name FROM sqlite_master WHERE type='table'")
    ).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['col', 'notes', 'cards', 'revlog', 'graves']));

    // Exactly one col row.
    const col = await queryAnki(anki2, 'SELECT models, decks, conf FROM col');
    expect(col).toHaveLength(1);
    const decksJson = JSON.parse(col[0]!.decks as string) as Record<
      string,
      { name: string; id: number }
    >;
    const deckNames = Object.values(decksJson).map((d) => d.name);
    // Deck hierarchy preserved via `::`-joined names.
    expect(deckNames).toContain('Languages');
    expect(deckNames).toContain('Languages::Spanish');
    expect(deckNames).toContain('Geo');

    // note count == card count == 4 seeded cards.
    const noteCount = Number((await queryAnki(anki2, 'SELECT count(*) AS n FROM notes'))[0]!.n);
    const cardCount = Number((await queryAnki(anki2, 'SELECT count(*) AS n FROM cards'))[0]!.n);
    expect(noteCount).toBe(4);
    expect(cardCount).toBe(4);

    // Graded card: ivl = 30, factor = round(2.5 * 1000) = 2500, type/queue review.
    const gradedCard = (
      await queryAnki(
        anki2,
        `SELECT c.ivl, c.factor, c.type, c.queue, c.did, c.reps
         FROM cards c JOIN notes n ON n.id = c.nid
         WHERE n.flds LIKE 'hola%'`,
      )
    )[0]!;
    expect(Number(gradedCard.ivl)).toBe(30);
    expect(Number(gradedCard.factor)).toBe(2500);
    expect(Number(gradedCard.type)).toBe(2);
    expect(Number(gradedCard.queue)).toBe(2);
    expect(Number(gradedCard.reps)).toBe(4);
    // Lives in the Languages::Spanish deck.
    const gradedDeck = decksJson[String(gradedCard.did)];
    expect(gradedDeck?.name).toBe('Languages::Spanish');

    // Suspended card: queue = -1.
    const suspendedCard = (
      await queryAnki(
        anki2,
        `SELECT c.queue, c.ivl FROM cards c JOIN notes n ON n.id = c.nid
         WHERE n.flds LIKE 'adios%'`,
      )
    )[0]!;
    expect(Number(suspendedCard.queue)).toBe(-1);
    expect(Number(suspendedCard.ivl)).toBe(12);

    // New card (no review row): type=0, queue=0, ivl=0, factor default.
    const newCard = (
      await queryAnki(
        anki2,
        `SELECT c.type, c.queue, c.ivl FROM cards c JOIN notes n ON n.id = c.nid
         WHERE n.flds LIKE 'uno%'`,
      )
    )[0]!;
    expect(Number(newCard.type)).toBe(0);
    expect(Number(newCard.queue)).toBe(0);
    expect(Number(newCard.ivl)).toBe(0);

    // Orphan card carries the `cairn-orphan` tag.
    const orphanNote = (
      await queryAnki(anki2, `SELECT tags, flds FROM notes WHERE flds LIKE 'capital of France%'`)
    )[0]!;
    expect(String(orphanNote.tags)).toContain('cairn-orphan');
    void orphan;

    // Fields are Front\x1fBack joined by the Anki field separator (0x1f).
    expect(String(gradedCard.ivl)).toBeDefined();
    const fldRow = (await queryAnki(anki2, `SELECT flds FROM notes WHERE flds LIKE 'hola%'`))[0]!;
    expect(String(fldRow.flds)).toBe('hola\x1fhello');
  });

  it('is workspace-scoped: another workspace gets no notes', async () => {
    const u1 = await createTestWorkspaceWithUser(db);
    const u2 = await createTestWorkspaceWithUser(db);
    const [deck] = await db
      .insert(schema.flashcardDecks)
      .values({ workspaceId: u1.workspaceId, name: 'W1' })
      .returning();
    await db.insert(schema.flashcardCards).values({
      workspaceId: u1.workspaceId,
      blockId: 'b1',
      front: 'q',
      back: 'a',
      deckId: deck!.id,
      createdBy: u1.userId,
    });

    const apkg = await buildApkg(db, { workspaceId: u2.workspaceId, userId: u2.userId });
    const anki2 = await readZipEntry(apkg, 'collection.anki2');
    const noteCount = Number((await queryAnki(anki2, 'SELECT count(*) AS n FROM notes'))[0]!.n);
    expect(noteCount).toBe(0);
  });

  it('handles a card with no deck (deckId null) under a fallback deck', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await db.insert(schema.flashcardCards).values({
      workspaceId: u.workspaceId,
      blockId: 'b-nodeck',
      front: 'orphaned deck',
      back: 'value',
      deckId: null,
      createdBy: u.userId,
    });
    const apkg = await buildApkg(db, { workspaceId: u.workspaceId, userId: u.userId });
    const anki2 = await readZipEntry(apkg, 'collection.anki2');
    const cardCount = Number((await queryAnki(anki2, 'SELECT count(*) AS n FROM cards'))[0]!.n);
    expect(cardCount).toBe(1);
    // The card must reference a valid deck id present in col.decks.
    const col = await queryAnki(anki2, 'SELECT decks FROM col');
    const decksJson = JSON.parse(col[0]!.decks as string) as Record<string, unknown>;
    const card = (await queryAnki(anki2, 'SELECT did FROM cards'))[0]!;
    expect(decksJson[String(card.did)]).toBeDefined();
  });
});
