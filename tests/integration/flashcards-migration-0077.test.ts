import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, stopPostgres } from '../helpers/db';

/**
 * Migration 0077 (v0.10.2 F1) end-to-end backfill test.
 *
 * The shared test container singleton already has EVERY migration applied
 * (through 0077), which is no good for exercising a backfill: we need to seed
 * LEGACY rows that exist BEFORE 0077 runs. So this test:
 *   1. spins a fresh database on the same container,
 *   2. applies migrations 0001–0076 only (via a temp migrations folder whose
 *      journal is truncated to idx 76),
 *   3. seeds legacy rows (workspace, user, cards with/without deck_tag, a card
 *      whose page is then hard-deleted, a review),
 *   4. applies the real 0077 SQL file,
 *   5. asserts decks seeded/backfilled, deck_id backfilled, reps default,
 *      page_id nullable + FK SET NULL (page delete orphans, doesn't cascade),
 *      and review rows survive.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'migrations');
const DB_NAME = 'cairn_mig_0077';

let adminSql: ReturnType<typeof postgres>;
let sql: ReturnType<typeof postgres>;
let tmpMigrations: string;
let workspaceId: string;
let userId: string;

beforeAll(async () => {
  const uri = await startPostgres();
  // Create a fresh, empty database on the shared container.
  adminSql = postgres(uri, { max: 1 });
  await adminSql`DROP DATABASE IF EXISTS ${adminSql(DB_NAME)} WITH (FORCE)`;
  await adminSql`CREATE DATABASE ${adminSql(DB_NAME)}`;
  const freshUri = uri.replace(/\/[^/]+$/, `/${DB_NAME}`);

  // Build a temp migrations folder: copy 0000..0076 + a journal truncated to
  // idx 76 so drizzle's migrator applies everything BEFORE 0077.
  tmpMigrations = mkdtempSync(join(tmpdir(), 'cairn-mig-0077-'));
  cpSync(MIGRATIONS_DIR, tmpMigrations, { recursive: true });
  rmSync(join(tmpMigrations, '0077_flashcards_manage.sql'), { force: true });
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as {
    entries: Array<{ idx: number }>;
  };
  journal.entries = journal.entries.filter((e) => e.idx <= 76);
  writeFileSync(join(tmpMigrations, 'meta', '_journal.json'), JSON.stringify(journal));

  const migrateSql = postgres(freshUri, { max: 1 });
  await migrate(drizzle(migrateSql), { migrationsFolder: tmpMigrations });
  await migrateSql.end();

  sql = postgres(freshUri);
}, 120_000);

afterAll(async () => {
  if (sql) await sql.end();
  if (tmpMigrations) rmSync(tmpMigrations, { recursive: true, force: true });
  if (adminSql) {
    await adminSql`DROP DATABASE IF EXISTS ${adminSql(DB_NAME)} WITH (FORCE)`;
    await adminSql.end();
  }
  await stopPostgres();
});

describe('migration 0077 — flashcards management backfill', () => {
  it('seeds, backfills, flips the page_id FK, and preserves review history', async () => {
    // --- 1. Seed legacy (pre-0077) rows. ---
    const [w] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (name, slug) VALUES ('W', 'w-0077') RETURNING id
    `;
    workspaceId = w!.id;
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, name)
      VALUES ('mig0077@example.com', 'h', 'U') RETURNING id
    `;
    userId = u!.id;

    // Two pages: one whose card stays attached, one we will hard-delete.
    const [pKeep] = await sql<{ id: string }[]>`
      INSERT INTO pages (workspace_id, title, created_by) VALUES (${workspaceId}, 'Keep', ${userId}) RETURNING id
    `;
    const [pGone] = await sql<{ id: string }[]>`
      INSERT INTO pages (workspace_id, title, created_by) VALUES (${workspaceId}, 'Gone', ${userId}) RETURNING id
    `;

    // Card with deck_tag 'spanish', card with deck_tag NULL, card on pGone with
    // deck_tag 'french'.
    const [cSpanish] = await sql<{ id: string }[]>`
      INSERT INTO flashcard_cards (page_id, workspace_id, block_id, front, back, deck_tag, created_by)
      VALUES (${pKeep!.id}, ${workspaceId}, 'b1', 'Q-es', 'A-es', 'spanish', ${userId}) RETURNING id
    `;
    const [cNull] = await sql<{ id: string }[]>`
      INSERT INTO flashcard_cards (page_id, workspace_id, block_id, front, back, deck_tag, created_by)
      VALUES (${pKeep!.id}, ${workspaceId}, 'b2', 'Q-x', 'A-x', NULL, ${userId}) RETURNING id
    `;
    const [cFrench] = await sql<{ id: string }[]>`
      INSERT INTO flashcard_cards (page_id, workspace_id, block_id, front, back, deck_tag, created_by)
      VALUES (${pGone!.id}, ${workspaceId}, 'b3', 'Q-fr', 'A-fr', 'french', ${userId}) RETURNING id
    `;
    // A review row on the card whose page will be hard-deleted (history to preserve).
    await sql`
      INSERT INTO flashcard_reviews (card_id, user_id, ease, interval) VALUES (${cFrench!.id}, ${userId}, 2.3, 6)
    `;

    // --- 2. Apply the real 0077 migration SQL. ---
    const file = readFileSync(join(MIGRATIONS_DIR, '0077_flashcards_manage.sql'), 'utf8');
    await sql.unsafe(file);

    // --- 3a. flashcard_decks: a "Default" per workspace + a deck per distinct deck_tag. ---
    const decks = await sql<{ name: string }[]>`
      SELECT name FROM flashcard_decks WHERE workspace_id = ${workspaceId} ORDER BY name
    `;
    expect(decks.map((d) => d.name).sort()).toEqual(['Default', 'french', 'spanish']);

    // --- 3b. deck_id backfilled: name match else Default. ---
    const [rSpanish] = await sql<{ deck_id: string }[]>`
      SELECT deck_id FROM flashcard_cards WHERE id = ${cSpanish!.id}
    `;
    const [spanishDeck] = await sql<{ id: string }[]>`
      SELECT id FROM flashcard_decks WHERE workspace_id = ${workspaceId} AND name = 'spanish'
    `;
    expect(rSpanish!.deck_id).toBe(spanishDeck!.id);

    const [rNull] = await sql<{ deck_id: string }[]>`
      SELECT deck_id FROM flashcard_cards WHERE id = ${cNull!.id}
    `;
    const [defaultDeck] = await sql<{ id: string }[]>`
      SELECT id FROM flashcard_decks WHERE workspace_id = ${workspaceId} AND name = 'Default'
    `;
    expect(rNull!.deck_id).toBe(defaultDeck!.id); // NULL deck_tag → Default

    // --- 3c. reps column present, default 0. ---
    const [rev] = await sql<{ reps: number }[]>`
      SELECT reps FROM flashcard_reviews WHERE card_id = ${cFrench!.id} AND user_id = ${userId}
    `;
    expect(rev!.reps).toBe(0);

    // --- 3d. page_id is nullable. ---
    const [col] = await sql<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'flashcard_cards' AND column_name = 'page_id'
    `;
    expect(col!.is_nullable).toBe('YES');

    // --- 3e. page_id FK is SET NULL. ---
    const [fk] = await sql<{ delete_rule: string }[]>`
      SELECT rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'flashcard_cards' AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'page_id'
    `;
    expect(fk!.delete_rule).toBe('SET NULL');

    // --- 3f. Deleting a page SET-NULLs its cards (NOT cascade-delete); reviews survive. ---
    await sql`DELETE FROM pages WHERE id = ${pGone!.id}`;
    const [survivor] = await sql<{ id: string; page_id: string | null }[]>`
      SELECT id, page_id FROM flashcard_cards WHERE id = ${cFrench!.id}
    `;
    expect(survivor).toBeDefined(); // NOT cascade-deleted
    expect(survivor!.page_id).toBeNull(); // page_id nulled by SET NULL FK
    const reviewsLeft = await sql`
      SELECT 1 FROM flashcard_reviews WHERE card_id = ${cFrench!.id} AND user_id = ${userId}
    `;
    expect(reviewsLeft).toHaveLength(1); // review history preserved
  });
});
