import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
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
  await sql`TRUNCATE notifications, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

describe('v0.3.0 notifications schema', () => {
  it('inserts a mention row with null read_at and non-null created_at', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [n] = await db
      .insert(schema.notifications)
      .values({
        userId: u.userId,
        workspaceId: u.workspaceId,
        type: 'mention',
        payload: {
          pageId: '00000000-0000-0000-0000-000000000001',
          commentId: '00000000-0000-0000-0000-000000000002',
          actorId: '00000000-0000-0000-0000-000000000003',
        },
      })
      .returning();
    expect(n?.readAt).toBeNull();
    expect(n?.createdAt).toBeInstanceOf(Date);
    expect(n?.type).toBe('mention');
  });

  it('round-trips payload as jsonb', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const payload = {
      pageId: '11111111-1111-1111-1111-111111111111',
      commentId: '22222222-2222-2222-2222-222222222222',
      actorId: '33333333-3333-3333-3333-333333333333',
    };
    const [n] = await db
      .insert(schema.notifications)
      .values({ userId: u.userId, workspaceId: u.workspaceId, type: 'comment_reply', payload })
      .returning();
    if (!n) throw new Error('insert failed');
    const [read] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, n.id));
    expect(read?.payload).toEqual(payload);
  });

  it('persists read_at when updated to a Date', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const [n] = await db
      .insert(schema.notifications)
      .values({
        userId: u.userId,
        workspaceId: u.workspaceId,
        type: 'mention',
        payload: {
          pageId: '00000000-0000-0000-0000-000000000001',
          commentId: '00000000-0000-0000-0000-000000000002',
          actorId: '00000000-0000-0000-0000-000000000003',
        },
      })
      .returning();
    if (!n) throw new Error('insert failed');
    const readAt = new Date();
    await db.update(schema.notifications).set({ readAt }).where(eq(schema.notifications.id, n.id));
    const [updated] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, n.id));
    expect(updated?.readAt?.getTime()).toBe(readAt.getTime());
  });

  it('cascades on user delete', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await db.insert(schema.notifications).values({
      userId: u.userId,
      workspaceId: u.workspaceId,
      type: 'mention',
      payload: {
        pageId: '00000000-0000-0000-0000-000000000001',
        commentId: '00000000-0000-0000-0000-000000000002',
        actorId: '00000000-0000-0000-0000-000000000003',
      },
    });
    await db.delete(schema.users).where(eq(schema.users.id, u.userId));
    const rows = await db.select().from(schema.notifications);
    expect(rows).toHaveLength(0);
  });

  it('cascades on workspace delete', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await db.insert(schema.notifications).values({
      userId: u.userId,
      workspaceId: u.workspaceId,
      type: 'comment_reply',
      payload: {
        pageId: '00000000-0000-0000-0000-000000000001',
        commentId: '00000000-0000-0000-0000-000000000002',
        actorId: '00000000-0000-0000-0000-000000000003',
      },
    });
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, u.workspaceId));
    const rows = await db.select().from(schema.notifications);
    expect(rows).toHaveLength(0);
  });
});
