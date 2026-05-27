import { eq, sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { ingestInboundReply } from '@/lib/chat/inbound';
import { recordPostedMessage } from '@/lib/chat/posted-log';
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
  await sql`TRUNCATE chat_posted_messages, comments, audit_log, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

async function seed(): Promise<{ workspaceId: string; pageId: string }> {
  const u = await createTestWorkspaceWithUser(db);
  const rows = (await db.execute(drizzleSql`
    INSERT INTO pages (id, workspace_id, title, content, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), ${u.workspaceId}::uuid, 't', '{}'::jsonb,
            ${u.userId}::uuid, now(), now())
    RETURNING id;
  `)) as unknown as Array<{ id: string }>;
  const pageId = rows[0]!.id;
  await recordPostedMessage(db, {
    workspaceId: u.workspaceId,
    pageId,
    platform: 'slack',
    channelId: 'C1',
    messageId: '1700000000.000100',
    threadTs: '1700000000.000100',
  });
  return { workspaceId: u.workspaceId, pageId };
}

describe('ingestInboundReply', () => {
  it('returns null when there is no matching posted-message row', async () => {
    await createTestWorkspaceWithUser(db);
    const id = await ingestInboundReply(db, {
      platform: 'slack',
      channelId: 'NOPE',
      threadTs: 'nope',
      body: 'hi',
      authorPlatformHandle: 'U1',
    });
    expect(id).toBeNull();
  });

  it('creates a sanitized comment + chat.inbound_comment_created audit row', async () => {
    const { workspaceId, pageId } = await seed();

    const id = await ingestInboundReply(db, {
      platform: 'slack',
      channelId: 'C1',
      threadTs: '1700000000.000100',
      body: 'Reply <script>alert(1)</script> body',
      authorPlatformHandle: 'U1',
      authorDisplayName: 'Real Name',
    });

    expect(id).not.toBeNull();

    const [comment] = await db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, id ?? ''));
    expect(comment).toBeDefined();
    expect(comment?.pageId).toBe(pageId);
    expect(comment?.workspaceId).toBe(workspaceId);
    // Sanitized: no script tag survives, body labeled with platform + name.
    expect(comment?.body).toContain('[slack:Real Name]');
    expect(comment?.body).not.toContain('<script>');

    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'chat.inbound_comment_created'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({ platform: 'slack', channel_id: 'C1' });
  });

  it('returns null when sanitized body is empty', async () => {
    await seed();
    const id = await ingestInboundReply(db, {
      platform: 'slack',
      channelId: 'C1',
      threadTs: '1700000000.000100',
      body: '<i></i>',
      authorPlatformHandle: 'U1',
    });
    expect(id).toBeNull();
  });

  it('reuses the chat-bot user across multiple replies', async () => {
    const { workspaceId } = await seed();
    await ingestInboundReply(db, {
      platform: 'slack',
      channelId: 'C1',
      threadTs: '1700000000.000100',
      body: 'first',
      authorPlatformHandle: 'U1',
    });
    await ingestInboundReply(db, {
      platform: 'slack',
      channelId: 'C1',
      threadTs: '1700000000.000100',
      body: 'second',
      authorPlatformHandle: 'U2',
    });
    const bots = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, `cairn-chat-bot+${workspaceId}@cairn.local`));
    expect(bots).toHaveLength(1);
  });
});
