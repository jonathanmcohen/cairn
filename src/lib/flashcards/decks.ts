import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

/**
 * Deck management (v0.10.2 F1). Decks are first-class, named, per-workspace
 * groupings of flashcards (`flashcard_cards.deck_id`). Every workspace has a
 * seeded "Default" deck (migration 0077); `ensureDefaultDeck` recreates it
 * lazily for workspaces created after the migration.
 *
 * db-injected + pure (business logic only); the API routes are Task B.
 */

type Db = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'insert' | 'update'>;

export const DEFAULT_DECK_NAME = 'Default';

export type DeckRow = {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

/** List a workspace's decks, alphabetical by name. */
export async function listDecks(db: Db, workspaceId: string): Promise<DeckRow[]> {
  return db
    .select()
    .from(schema.flashcardDecks)
    .where(eq(schema.flashcardDecks.workspaceId, workspaceId))
    .orderBy(asc(schema.flashcardDecks.name));
}

/**
 * Ensure a "Default" deck exists for the workspace and return it. Idempotent:
 * if one already exists it is returned untouched; otherwise it is created. Uses
 * an ON CONFLICT DO NOTHING insert so concurrent callers can't create a
 * duplicate (the (workspace_id, name) unique constraint backs it).
 */
export async function ensureDefaultDeck(db: Db, workspaceId: string): Promise<DeckRow> {
  await db
    .insert(schema.flashcardDecks)
    .values({ workspaceId, name: DEFAULT_DECK_NAME })
    .onConflictDoNothing({
      target: [schema.flashcardDecks.workspaceId, schema.flashcardDecks.name],
    });
  const [row] = await db
    .select()
    .from(schema.flashcardDecks)
    .where(
      and(
        eq(schema.flashcardDecks.workspaceId, workspaceId),
        eq(schema.flashcardDecks.name, DEFAULT_DECK_NAME),
      ),
    )
    .limit(1);
  if (!row) throw new Error('ensureDefaultDeck: default deck missing after upsert');
  return row;
}

/**
 * Create a named deck in a workspace. Throws if a deck with that name already
 * exists (caller maps to a 409). The name is trimmed; empty names are rejected.
 */
export async function createDeck(db: Db, workspaceId: string, name: string): Promise<DeckRow> {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('Deck name is required');
  const existing = await db
    .select({ id: schema.flashcardDecks.id })
    .from(schema.flashcardDecks)
    .where(
      and(
        eq(schema.flashcardDecks.workspaceId, workspaceId),
        eq(schema.flashcardDecks.name, trimmed),
      ),
    )
    .limit(1);
  if (existing[0]) throw new Error('A deck with that name already exists');
  const [row] = await db
    .insert(schema.flashcardDecks)
    .values({ workspaceId, name: trimmed })
    .returning();
  if (!row) throw new Error('createDeck: insert returned no row');
  return row;
}

/**
 * Rename a deck within a workspace. Throws if the new name collides with
 * another deck in the same workspace, or the deck does not exist / belongs to
 * a different workspace.
 */
export async function renameDeck(
  db: Db,
  workspaceId: string,
  deckId: string,
  name: string,
): Promise<DeckRow> {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('Deck name is required');
  const clash = await db
    .select({ id: schema.flashcardDecks.id })
    .from(schema.flashcardDecks)
    .where(
      and(
        eq(schema.flashcardDecks.workspaceId, workspaceId),
        eq(schema.flashcardDecks.name, trimmed),
      ),
    )
    .limit(1);
  if (clash[0] && clash[0].id !== deckId) {
    throw new Error('A deck with that name already exists');
  }
  const [row] = await db
    .update(schema.flashcardDecks)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(
      and(eq(schema.flashcardDecks.id, deckId), eq(schema.flashcardDecks.workspaceId, workspaceId)),
    )
    .returning();
  if (!row) throw new Error('Deck not found');
  return row;
}
