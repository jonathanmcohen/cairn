import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { reconcileFlashcardsRaw } from '@/lib/flashcards/reconcile-raw';
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
  await sql`TRUNCATE flashcard_reviews, flashcard_cards, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

function docWith(blocks: Array<Record<string, unknown>>) {
  return {
    type: 'doc',
    content: blocks.map((attrs) => ({ type: 'flashcard', attrs })),
  };
}

describe('reconcileFlashcardsRaw', () => {
  it('upserts a flashcard_cards row keyed by (page_id, block_id) using the page author as created_by', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });

    await reconcileFlashcardsRaw(sql, {
      pageId: page.id,
      content: docWith([{ blockId: 'b1', front: 'Q1', back: 'A1', deckTag: 'spanish' }]),
    });

    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.blockId).toBe('b1');
    expect(cards[0]?.front).toBe('Q1');
    expect(cards[0]?.deckTag).toBe('spanish');
    expect(cards[0]?.workspaceId).toBe(u.workspaceId);
    expect(cards[0]?.createdBy).toBe(u.userId);
  });

  it('mints a non-empty block id when the block has none', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });

    await reconcileFlashcardsRaw(sql, {
      pageId: page.id,
      content: docWith([{ front: 'Q', back: 'A' }]),
    });

    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(typeof cards[0]?.blockId).toBe('string');
    expect(cards[0]?.blockId.length).toBeGreaterThan(0);
  });

  it('is idempotent: re-running the same doc updates in place, no duplicate rows', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const content = docWith([{ blockId: 'b1', front: 'Q', back: 'A', deckTag: null }]);

    await reconcileFlashcardsRaw(sql, { pageId: page.id, content });
    await reconcileFlashcardsRaw(sql, { pageId: page.id, content });

    expect(await db.select().from(schema.flashcardCards)).toHaveLength(1);
  });

  it('updates front/back/deck when the same block id reappears edited', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    await reconcileFlashcardsRaw(sql, {
      pageId: page.id,
      content: docWith([{ blockId: 'b1', front: 'Q', back: 'A', deckTag: null }]),
    });
    await reconcileFlashcardsRaw(sql, {
      pageId: page.id,
      content: docWith([{ blockId: 'b1', front: 'Q2', back: 'A2', deckTag: 'tag' }]),
    });
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.front).toBe('Q2');
    expect(cards[0]?.deckTag).toBe('tag');
  });

  it('orphan-marks (does NOT delete) rows whose block id vanished from the doc', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    await reconcileFlashcardsRaw(sql, {
      pageId: page.id,
      content: docWith([{ blockId: 'b1', front: 'q', back: 'a', deckTag: null }]),
    });
    expect(await db.select().from(schema.flashcardCards)).toHaveLength(1);

    await reconcileFlashcardsRaw(sql, { pageId: page.id, content: { type: 'doc', content: [] } });
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.sourceOrphanedAt).not.toBeNull();
  });

  it('no-ops for a missing page (defensive — never throws)', async () => {
    await expect(
      reconcileFlashcardsRaw(sql, {
        pageId: '00000000-0000-0000-0000-000000000000',
        content: docWith([{ blockId: 'b1', front: 'q', back: 'a' }]),
      }),
    ).resolves.toBeUndefined();
  });
});
