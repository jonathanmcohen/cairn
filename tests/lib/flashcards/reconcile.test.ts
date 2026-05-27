import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { extractFlashcardBlocks } from '@/lib/flashcards/reconcile';
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
  await sql`TRUNCATE flashcard_reviews, flashcard_cards, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

describe('extractFlashcardBlocks', () => {
  it('finds top-level flashcard blocks and mints blockIds when missing', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'flashcard', attrs: { front: 'Q1', back: 'A1' } },
        { type: 'flashcard', attrs: { blockId: 'b-fixed', front: 'Q2', back: 'A2', deckTag: 't' } },
      ],
    };
    const blocks = extractFlashcardBlocks(doc);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.front).toBe('Q1');
    expect(typeof blocks[0]!.blockId).toBe('string');
    expect(blocks[0]!.blockId.length).toBeGreaterThan(0);
    expect(blocks[1]!.blockId).toBe('b-fixed');
    expect(blocks[1]!.deckTag).toBe('t');
  });

  it('recurses into nested content (e.g. columns)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'columnList',
          content: [
            {
              type: 'column',
              content: [{ type: 'flashcard', attrs: { blockId: 'x', front: 'F', back: 'B' } }],
            },
          ],
        },
      ],
    };
    expect(extractFlashcardBlocks(doc)).toHaveLength(1);
  });

  it('returns an empty array for a doc with no flashcards', () => {
    expect(extractFlashcardBlocks({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual([]);
  });
});

describe('reconcile on page update', () => {
  it('creates flashcard rows for every block on save', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    await updatePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      patch: {
        content: {
          type: 'doc',
          content: [
            {
              type: 'flashcard',
              attrs: { blockId: 'b1', front: 'Q1', back: 'A1', deckTag: 'spanish' },
            },
            { type: 'flashcard', attrs: { blockId: 'b2', front: 'Q2', back: 'A2', deckTag: null } },
          ],
        },
      },
      byUserId: u.userId,
      adminOverride: false,
    });
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.blockId).sort()).toEqual(['b1', 'b2']);
  });

  it('updates an existing row when the same blockId reappears', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    await updatePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      patch: {
        content: {
          type: 'doc',
          content: [
            { type: 'flashcard', attrs: { blockId: 'b1', front: 'Q', back: 'A', deckTag: null } },
          ],
        },
      },
      byUserId: u.userId,
      adminOverride: false,
    });
    await updatePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      patch: {
        content: {
          type: 'doc',
          content: [
            {
              type: 'flashcard',
              attrs: { blockId: 'b1', front: 'Q-updated', back: 'A-updated', deckTag: 'tag' },
            },
          ],
        },
      },
      byUserId: u.userId,
      adminOverride: false,
    });
    const cards = await db.select().from(schema.flashcardCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.front).toBe('Q-updated');
    expect(cards[0]!.deckTag).toBe('tag');
  });

  it('deletes flashcard rows whose blockId vanished from the doc', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    await updatePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      patch: {
        content: {
          type: 'doc',
          content: [
            { type: 'flashcard', attrs: { blockId: 'b1', front: 'q', back: 'a', deckTag: null } },
          ],
        },
      },
      byUserId: u.userId,
      adminOverride: false,
    });
    expect(await db.select().from(schema.flashcardCards)).toHaveLength(1);
    await updatePage(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      patch: { content: { type: 'doc', content: [] } },
      byUserId: u.userId,
      adminOverride: false,
    });
    expect(await db.select().from(schema.flashcardCards)).toHaveLength(0);
  });
});
