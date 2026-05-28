import { sql as drizzleSql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { isMessageProcessed, markMessageProcessed } from '@/lib/chat/dedupe';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE comments, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

async function seedPage(workspaceId: string, userId: string): Promise<string> {
  const rows = (await db.execute(drizzleSql`
    INSERT INTO pages (id, workspace_id, title, content, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), ${workspaceId}::uuid, 't', '{}'::jsonb,
            ${userId}::uuid, now(), now())
    RETURNING id;
  `)) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

describe('chat dedupe', () => {
  it('returns false for an unseen message id', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const pageId = await seedPage(u.workspaceId, u.userId);
    expect(await isMessageProcessed({ pageId, chatMessageId: 'M1', db })).toBe(false);
  });

  it('returns true after markMessageProcessed', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const pageId = await seedPage(u.workspaceId, u.userId);
    await markMessageProcessed({
      workspaceId: u.workspaceId,
      pageId,
      authorUserId: u.userId,
      chatMessageId: 'M1',
      body: 'hello',
      db,
    });
    expect(await isMessageProcessed({ pageId, chatMessageId: 'M1', db })).toBe(true);
  });

  it('isolates per page', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const page1 = await seedPage(u.workspaceId, u.userId);
    const page2 = await seedPage(u.workspaceId, u.userId);
    await markMessageProcessed({
      workspaceId: u.workspaceId,
      pageId: page1,
      authorUserId: u.userId,
      chatMessageId: 'M1',
      body: 'x',
      db,
    });
    expect(await isMessageProcessed({ pageId: page1, chatMessageId: 'M1', db })).toBe(true);
    expect(await isMessageProcessed({ pageId: page2, chatMessageId: 'M1', db })).toBe(false);
  });

  it('persists the chat_message_id on the comment row', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const pageId = await seedPage(u.workspaceId, u.userId);
    const { commentId } = await markMessageProcessed({
      workspaceId: u.workspaceId,
      pageId,
      authorUserId: u.userId,
      chatMessageId: 'M-persist',
      body: 'persistent',
      db,
    });
    const [row] = await db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, commentId))
      .limit(1);
    expect(row?.chatMessageId).toBe('M-persist');
    expect(row?.body).toBe('persistent');
  });
});
