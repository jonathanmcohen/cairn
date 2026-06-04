import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  notifyApprovalDecision,
  notifyPageLock,
  notifyStatusChange,
} from '@/lib/notifications/create';
import { startPostgres, stopPostgres } from '../helpers/db';
import { createTestWorkspaceWithUser } from '../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

async function seed() {
  const { workspaceId, userId: actorId } = await createTestWorkspaceWithUser(db);
  const [author] = await db
    .insert(schema.users)
    .values({ email: `author-${actorId}@example.com`, passwordHash: 'h', name: 'Author' })
    .returning({ id: schema.users.id });
  if (!author) throw new Error('author insert failed');
  const [page] = await db
    .insert(schema.pages)
    .values({ workspaceId, title: 'P', createdBy: actorId })
    .returning({ id: schema.pages.id });
  if (!page) throw new Error('page insert failed');
  return { workspaceId, actorId, authorId: author.id, pageId: page.id };
}

describe('approval / status / lock notification emitters (#195)', () => {
  it('notifyApprovalDecision creates a page_approval row for the recipient, excluding the actor', async () => {
    const { workspaceId, actorId, authorId, pageId } = await seed();
    const rows = await notifyApprovalDecision(db, {
      actorId,
      pageId,
      workspaceId,
      decision: 'approved',
      recipientIds: [authorId, actorId],
    });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.type).toBe('page_approval');
    expect(row?.userId).toBe(authorId);
    expect((row?.payload as { decision: string }).decision).toBe('approved');
  });

  it('notifyStatusChange creates a page_status row with the status payload', async () => {
    const { workspaceId, actorId, authorId, pageId } = await seed();
    const rows = await notifyStatusChange(db, {
      actorId,
      pageId,
      workspaceId,
      status: 'published',
      recipientIds: [authorId],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('page_status');
    expect((rows[0]?.payload as { status: string }).status).toBe('published');
  });

  it('notifyPageLock creates a page_lock row with locked=true', async () => {
    const { workspaceId, actorId, authorId, pageId } = await seed();
    const rows = await notifyPageLock(db, {
      actorId,
      pageId,
      workspaceId,
      locked: true,
      recipientIds: [authorId],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('page_lock');
    expect((rows[0]?.payload as { locked: boolean }).locked).toBe(true);
  });

  it('returns [] when the only recipient is the actor', async () => {
    const { workspaceId, actorId, pageId } = await seed();
    const rows = await notifyPageLock(db, {
      actorId,
      pageId,
      workspaceId,
      locked: false,
      recipientIds: [actorId],
    });
    expect(rows).toHaveLength(0);
    const stored = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.workspaceId, workspaceId),
          eq(schema.notifications.type, 'page_lock'),
        ),
      );
    expect(stored).toHaveLength(0);
  });
});
