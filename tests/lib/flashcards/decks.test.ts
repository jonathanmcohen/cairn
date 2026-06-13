import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createDeck, ensureDefaultDeck, listDecks, renameDeck } from '@/lib/flashcards/decks';
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

describe('flashcards decks', () => {
  it('ensureDefaultDeck creates a Default deck and is idempotent', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const first = await ensureDefaultDeck(db, u.workspaceId);
    expect(first.name).toBe('Default');
    const second = await ensureDefaultDeck(db, u.workspaceId);
    expect(second.id).toBe(first.id); // no duplicate

    const all = await listDecks(db, u.workspaceId);
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Default');
  });

  it('createDeck adds a named deck and rejects duplicate names', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const d = await createDeck(db, u.workspaceId, 'Spanish');
    expect(d.name).toBe('Spanish');
    await expect(createDeck(db, u.workspaceId, 'Spanish')).rejects.toThrow(/already exists/i);
    await expect(createDeck(db, u.workspaceId, '   ')).rejects.toThrow(/required/i);
  });

  it('renameDeck renames and rejects collisions', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const a = await createDeck(db, u.workspaceId, 'A');
    await createDeck(db, u.workspaceId, 'B');
    const renamed = await renameDeck(db, u.workspaceId, a.id, 'A2');
    expect(renamed.name).toBe('A2');
    await expect(renameDeck(db, u.workspaceId, a.id, 'B')).rejects.toThrow(/already exists/i);
  });

  it('listDecks is workspace-scoped', async () => {
    const u1 = await createTestWorkspaceWithUser(db);
    const u2 = await createTestWorkspaceWithUser(db);
    await createDeck(db, u1.workspaceId, 'OnlyW1');
    expect(await listDecks(db, u2.workspaceId)).toHaveLength(0);
  });
});
