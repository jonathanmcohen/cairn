import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { notifyDueFlashcards } from '@/lib/flashcards/notify-due';
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
  await sql`TRUNCATE notifications, flashcard_reviews, flashcard_cards, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

async function seedCardForUser(userOpts?: { role?: schema.MemberRole }): Promise<{
  userId: string;
  workspaceId: string;
}> {
  const u = await createTestWorkspaceWithUser(db, userOpts);
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
  return { userId: u.userId, workspaceId: u.workspaceId };
}

describe('notifyDueFlashcards', () => {
  it('creates one notification per user with due cards', async () => {
    const { userId, workspaceId } = await seedCardForUser();
    const result = await notifyDueFlashcards(db);
    expect(result.notified).toBe(1);
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.workspaceId, workspaceId),
          eq(schema.notifications.type, 'flashcards_due'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { count?: number }).count).toBe(1);
  });

  it('is idempotent within the same UTC day', async () => {
    await seedCardForUser();
    const first = await notifyDueFlashcards(db);
    const second = await notifyDueFlashcards(db);
    expect(first.notified).toBe(1);
    expect(second.notified).toBe(0);
  });

  it('skips users with zero due cards', async () => {
    await createTestWorkspaceWithUser(db);
    const result = await notifyDueFlashcards(db);
    expect(result.notified).toBe(0);
  });

  it('does not notify users for cards in workspaces they are not members of', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const pageA = await createPage(db, {
      workspaceId: a.workspaceId,
      createdBy: a.userId,
      title: 'p',
    });
    await upsertCard(db, {
      pageId: pageA.id,
      workspaceId: a.workspaceId,
      blockId: 'b1',
      front: 'Q',
      back: 'A',
      deckTag: null,
      createdBy: a.userId,
    });
    // B is in a different workspace; should not be notified about A's cards.
    const b = await createTestWorkspaceWithUser(db);
    const result = await notifyDueFlashcards(db);
    expect(result.notified).toBe(1);
    const bRows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, b.userId));
    expect(bRows).toHaveLength(0);
  });
});
