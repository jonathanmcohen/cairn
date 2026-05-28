import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { listDueForUser } from '@/lib/flashcards/due-queue';
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
  await sql`TRUNCATE flashcard_reviews, flashcard_cards, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

describe('flashcards due-queue', () => {
  it('returns brand-new cards as immediately due (no review row)', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    await upsertCard(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: u.userId,
    });
    const due = await listDueForUser(db, u.userId);
    expect(due).toHaveLength(1);
    expect(due[0]!.front).toBe('Q');
    expect(due[0]!.ease).toBe(2.5);
    expect(due[0]!.interval).toBe(0);
  });

  it('excludes cards whose review.due_at is in the future', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const card = await upsertCard(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: u.userId,
    });
    const future = new Date(Date.now() + 86_400_000);
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: card.id, userId: u.userId, dueAt: future });
    const due = await listDueForUser(db, u.userId);
    expect(due).toHaveLength(0);
  });

  it('includes cards whose review.due_at is in the past', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const card = await upsertCard(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: u.userId,
    });
    const past = new Date(Date.now() - 86_400_000);
    await db
      .insert(schema.flashcardReviews)
      .values({ cardId: card.id, userId: u.userId, dueAt: past });
    const due = await listDueForUser(db, u.userId);
    expect(due).toHaveLength(1);
  });

  it('filters by deck tag', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    await upsertCard(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q1',
      back: 'A1',
      deckTag: 'spanish',
      createdBy: u.userId,
    });
    await upsertCard(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b2',
      front: 'Q2',
      back: 'A2',
      deckTag: 'french',
      createdBy: u.userId,
    });
    const due = await listDueForUser(db, u.userId, { deckTag: 'spanish' });
    expect(due).toHaveLength(1);
    expect(due[0]!.front).toBe('Q1');
  });

  it('per-user scheduling: user A reviewing does not hide card from user B', async () => {
    const a = await createTestWorkspaceWithUser(db);
    // Add a second member to the same workspace via direct insert.
    const [b] = await db
      .insert(schema.users)
      .values({ email: 'b@example.com', passwordHash: 'h', name: 'B' })
      .returning();
    if (!b) throw new Error('seed user B failed');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: a.workspaceId, userId: b.id, role: 'editor' });
    const page = await createPage(db, {
      workspaceId: a.workspaceId,
      createdBy: a.userId,
      title: 'p',
    });
    const card = await upsertCard(db, {
      pageId: page.id,
      workspaceId: a.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: a.userId,
    });
    // A schedules the card 7 days out.
    await db.insert(schema.flashcardReviews).values({
      cardId: card.id,
      userId: a.userId,
      dueAt: new Date(Date.now() + 7 * 86_400_000),
      interval: 7,
      ease: 2.5,
    });
    const aDue = await listDueForUser(db, a.userId);
    const bDue = await listDueForUser(db, b.id);
    expect(aDue).toHaveLength(0);
    expect(bDue).toHaveLength(1);
  });

  it('upsertCard is idempotent on (page_id, block_id) and updates fields', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page = await createPage(db, {
      workspaceId: u.workspaceId,
      createdBy: u.userId,
      title: 'p',
    });
    const first = await upsertCard(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: u.userId,
    });
    const second = await upsertCard(db, {
      pageId: page.id,
      workspaceId: u.workspaceId,
      blockId: 'b1',
      front: 'Q2',
      back: 'A2',
      deckTag: 'updated',
      createdBy: u.userId,
    });
    expect(second.id).toBe(first.id);
    const all = await db
      .select()
      .from(schema.flashcardCards)
      .where(
        and(eq(schema.flashcardCards.pageId, page.id), eq(schema.flashcardCards.blockId, 'b1')),
      );
    expect(all).toHaveLength(1);
    expect(all[0]!.front).toBe('Q2');
    expect(all[0]!.deckTag).toBe('updated');
  });
});
