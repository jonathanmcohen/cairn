import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { reconcileFlashcardsRaw } from '@/lib/flashcards/reconcile-raw';
import { createPage } from '@/lib/pages/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

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
  await sql`TRUNCATE flashcard_reviews, flashcard_cards, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

/**
 * Mirror exactly what collab/server.ts#materialize() does after this plan:
 * write pages.content with the merged ProseMirror JSON, then reconcile
 * flashcards. Proves an editor-authored card reaches the SRS via the collab
 * path (#114) and persists with a non-empty block id (#115).
 */
async function simulateCollabMaterialize(pageId: string, prose: unknown): Promise<void> {
  const contentJson = JSON.stringify(prose);
  await sql`UPDATE pages SET content = ${contentJson}::jsonb, updated_at = now() WHERE id = ${pageId}`;
  await reconcileFlashcardsRaw(sql, { pageId, content: prose });
}

describe('collab materialize → flashcard SRS ingest', () => {
  it('persists an editor-authored card to flashcard_cards with a non-empty block id', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });

    const prose = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'notes' }] },
        {
          type: 'flashcard',
          attrs: { blockId: 'card-1', front: 'Capital of France?', back: 'Paris', deckTag: 'geo' },
        },
      ],
    };
    await simulateCollabMaterialize(page.id, prose);

    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.blockId).toBe('card-1');
    expect(cards[0]?.blockId.length).toBeGreaterThan(0);
    expect(cards[0]?.front).toBe('Capital of France?');
    expect(cards[0]?.back).toBe('Paris');

    // And the page content was written too (the existing materialize behavior).
    const rows = await db.select().from(schema.pages);
    expect(rows).toHaveLength(1);
  });

  it('is idempotent across repeated autosaves (no duplicate rows)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const prose = {
      type: 'doc',
      content: [
        { type: 'flashcard', attrs: { blockId: 'card-1', front: 'Q', back: 'A', deckTag: null } },
      ],
    };

    await simulateCollabMaterialize(page.id, prose);
    await simulateCollabMaterialize(page.id, prose);
    await simulateCollabMaterialize(page.id, prose);

    expect(await db.select().from(schema.flashcardCards)).toHaveLength(1);
  });
});
