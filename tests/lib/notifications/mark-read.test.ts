import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { markAllRead, markRead } from '@/lib/notifications/list';
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
  await sql`TRUNCATE notifications, comments, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

type SeedInput = {
  userId: string;
  workspaceId: string;
  type?: schema.NotificationType;
  readAt?: Date | null;
};

async function seedNotification(input: SeedInput): Promise<schema.Notification> {
  const [row] = await db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      type: input.type ?? 'mention',
      payload: {
        pageId: '11111111-1111-1111-1111-111111111111',
        commentId: '22222222-2222-2222-2222-222222222222',
        actorId: '33333333-3333-3333-3333-333333333333',
      },
      readAt: input.readAt ?? null,
    })
    .returning();
  if (!row) throw new Error('seed failed');
  return row;
}

describe('markRead / markAllRead', () => {
  it('markRead sets readAt for a single id, scoped by (userId, workspaceId)', async () => {
    const me = await createTestWorkspaceWithUser(db);
    const n = await seedNotification({ userId: me.userId, workspaceId: me.workspaceId });
    expect(n.readAt).toBeNull();

    const result = await markRead(db, {
      id: n.id,
      userId: me.userId,
      workspaceId: me.workspaceId,
    });
    expect(result.affected).toBe(1);

    const [updated] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, n.id));
    expect(updated?.readAt).not.toBeNull();
  });

  it('markRead is idempotent on already-read rows (affected: 0)', async () => {
    const me = await createTestWorkspaceWithUser(db);
    const n = await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      readAt: new Date('2026-01-01T00:00:00Z'),
    });
    const result = await markRead(db, {
      id: n.id,
      userId: me.userId,
      workspaceId: me.workspaceId,
    });
    expect(result.affected).toBe(0);
    // The original readAt is unchanged.
    const [unchanged] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, n.id));
    expect(unchanged?.readAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('markRead returns affected: 0 for cross-user attempts (no exception, no row touched)', async () => {
    const a = await createTestWorkspaceWithUser(db);
    const b = await createTestWorkspaceWithUser(db);
    const n = await seedNotification({ userId: a.userId, workspaceId: a.workspaceId });

    const result = await markRead(db, {
      id: n.id,
      userId: b.userId,
      workspaceId: a.workspaceId,
    });
    expect(result.affected).toBe(0);
    const [unchanged] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, n.id));
    expect(unchanged?.readAt).toBeNull();
  });

  it('markAllRead flips every unread row for (userId, workspaceId) in one tx', async () => {
    const me = await createTestWorkspaceWithUser(db);
    for (let i = 0; i < 5; i++) {
      await seedNotification({ userId: me.userId, workspaceId: me.workspaceId });
    }
    const readAlready = await seedNotification({
      userId: me.userId,
      workspaceId: me.workspaceId,
      readAt: new Date('2026-01-01T00:00:00Z'),
    });
    const otherWs = await createTestWorkspaceWithUser(db);
    const otherWsRow = await seedNotification({
      userId: me.userId,
      workspaceId: otherWs.workspaceId,
    });

    const result = await markAllRead(db, {
      userId: me.userId,
      workspaceId: me.workspaceId,
    });
    expect(result.affected).toBe(5);

    const allInWs = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, me.userId),
          eq(schema.notifications.workspaceId, me.workspaceId),
        ),
      );
    expect(allInWs).toHaveLength(6);
    expect(allInWs.every((r) => r.readAt !== null)).toBe(true);

    // Already-read row keeps its original readAt timestamp.
    const [stillReadAlready] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, readAlready.id));
    expect(stillReadAlready?.readAt).toEqual(new Date('2026-01-01T00:00:00Z'));

    // Cross-workspace row stays unread.
    const [stillUnreadOther] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, otherWsRow.id));
    expect(stillUnreadOther?.readAt).toBeNull();
  });
});
