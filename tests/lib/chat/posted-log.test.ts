import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { lookupPostedMessage, recordPostedMessage } from '@/lib/chat/posted-log';
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
  await sql`TRUNCATE chat_posted_messages, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
});

async function seedPage(): Promise<{ workspaceId: string; pageId: string }> {
  const u = await createTestWorkspaceWithUser(db);
  const pageId = '12121212-1212-1212-1212-121212121212';
  await db.execute(drizzleSql`
    INSERT INTO pages (id, workspace_id, title, content, created_by, created_at, updated_at)
    VALUES (${pageId}::uuid, ${u.workspaceId}::uuid, 't', '{}'::jsonb,
            ${u.userId}::uuid, now(), now());
  `);
  return { workspaceId: u.workspaceId, pageId };
}

describe('posted-log', () => {
  it('records + looks up by (platform, channel_id, thread_ts)', async () => {
    const { workspaceId, pageId } = await seedPage();
    await recordPostedMessage(db, {
      workspaceId,
      pageId,
      platform: 'slack',
      channelId: 'C1',
      messageId: '1700000000.000100',
      threadTs: '1700000000.000100',
    });
    const found = await lookupPostedMessage(db, {
      platform: 'slack',
      channelId: 'C1',
      threadTs: '1700000000.000100',
    });
    expect(found).not.toBeNull();
    expect(found?.pageId).toBe(pageId);
    expect(found?.platform).toBe('slack');
  });

  it('looks up by (platform, channel_id, message_id) when threadTs missing', async () => {
    const { workspaceId, pageId } = await seedPage();
    await recordPostedMessage(db, {
      workspaceId,
      pageId,
      platform: 'discord',
      channelId: 'CHAN-D',
      messageId: 'msg-1',
      threadTs: null,
    });
    const found = await lookupPostedMessage(db, {
      platform: 'discord',
      channelId: 'CHAN-D',
      messageId: 'msg-1',
    });
    expect(found?.pageId).toBe(pageId);
  });

  it('returns null when no match', async () => {
    await seedPage();
    const result = await lookupPostedMessage(db, {
      platform: 'slack',
      channelId: 'C2',
      threadTs: 'nope',
    });
    expect(result).toBeNull();
  });

  it('returns null when neither threadTs nor messageId is supplied', async () => {
    await seedPage();
    const result = await lookupPostedMessage(db, {
      platform: 'slack',
      channelId: 'C1',
    });
    expect(result).toBeNull();
  });

  it('is idempotent on the unique (platform, channel, thread_ts) constraint', async () => {
    const { workspaceId, pageId } = await seedPage();
    await recordPostedMessage(db, {
      workspaceId,
      pageId,
      platform: 'slack',
      channelId: 'C1',
      messageId: 'm1',
      threadTs: 'T1',
    });
    // Second insert with the same thread_ts must not throw — the helper uses
    // onConflictDoNothing so dispatch can retry safely.
    await expect(
      recordPostedMessage(db, {
        workspaceId,
        pageId,
        platform: 'slack',
        channelId: 'C1',
        messageId: 'm2',
        threadTs: 'T1',
      }),
    ).resolves.toBeUndefined();
  });
});
