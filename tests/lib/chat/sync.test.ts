import { sql as drizzleSql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { resetRateLimitForTests } from '@/lib/chat/ratelimit';
import { ingestChannelMessage, postCommentToChannels } from '@/lib/chat/sync';
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
  await sql`TRUNCATE chat_channel_links, chat_bridge_installs, comments, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
  resetRateLimitForTests();
});

type SeedOptions = {
  encryptedPage?: boolean;
  linkMode?: 'sync' | 'notify';
  options?: Record<string, unknown>;
};

async function seedAll(opts: SeedOptions = {}): Promise<{
  workspaceId: string;
  userId: string;
  installId: string;
  pageId: string;
}> {
  const u = await createTestWorkspaceWithUser(db);

  const installRows = (await db.execute(drizzleSql`
    INSERT INTO chat_bridge_installs
      (workspace_id, platform, team_id, bot_token, signing_secret, installed_by, options)
    VALUES
      (${u.workspaceId}::uuid, 'slack', 'T1', 'xoxb-stub', 'shh',
       ${u.userId}::uuid, ${drizzleSql.raw(`'${JSON.stringify(opts.options ?? {})}'::jsonb`)})
    RETURNING id;
  `)) as unknown as Array<{ id: string }>;
  const installId = installRows[0]!.id;

  const pageRows = (await db.execute(drizzleSql`
    INSERT INTO pages (id, workspace_id, title, content, encrypted, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), ${u.workspaceId}::uuid, 't', '{}'::jsonb,
            ${opts.encryptedPage ?? false}, ${u.userId}::uuid, now(), now())
    RETURNING id;
  `)) as unknown as Array<{ id: string }>;
  const pageId = pageRows[0]!.id;

  await db.execute(drizzleSql`
    INSERT INTO chat_channel_links
      (workspace_id, install_id, channel_id, page_id, link_mode, linked_by)
    VALUES
      (${u.workspaceId}::uuid, ${installId}::uuid, 'C1', ${pageId}::uuid,
       ${opts.linkMode ?? 'sync'}, ${u.userId}::uuid);
  `);

  return { workspaceId: u.workspaceId, userId: u.userId, installId, pageId };
}

describe('ingestChannelMessage', () => {
  it('appends a comment for sync-mode channels + sanitizes HTML', async () => {
    const s = await seedAll();
    const result = await ingestChannelMessage({
      installId: s.installId,
      channelId: 'C1',
      messageId: 'M1',
      authorChatUserId: 'U_human',
      body: '<script>alert(1)</script>hello',
      db,
    });
    expect(result.kind).toBe('inserted');
    const rows = await db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.pageId, s.pageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).not.toContain('<script');
    expect(rows[0]?.body).toContain('hello');
    expect(rows[0]?.chatMessageId).toBe('M1');
  });

  it('dedupes duplicate message ids', async () => {
    const s = await seedAll();
    await ingestChannelMessage({
      installId: s.installId,
      channelId: 'C1',
      messageId: 'M1',
      authorChatUserId: 'U_human',
      body: 'hello',
      db,
    });
    const second = await ingestChannelMessage({
      installId: s.installId,
      channelId: 'C1',
      messageId: 'M1',
      authorChatUserId: 'U_human',
      body: 'hello',
      db,
    });
    expect(second.kind).toBe('duplicate');
    const rows = await db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.pageId, s.pageId));
    expect(rows).toHaveLength(1);
  });

  it('skips messages authored by the bot itself', async () => {
    const s = await seedAll({ options: { botUserId: 'U_bot' } });
    const r = await ingestChannelMessage({
      installId: s.installId,
      channelId: 'C1',
      messageId: 'M_echo',
      authorChatUserId: 'U_bot',
      body: 'echo',
      db,
    });
    expect(r.kind).toBe('skipped_bot');
    const rows = await db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.pageId, s.pageId));
    expect(rows).toHaveLength(0);
  });

  it('ignores notify-mode channels', async () => {
    const s = await seedAll({ linkMode: 'notify' });
    const r = await ingestChannelMessage({
      installId: s.installId,
      channelId: 'C1',
      messageId: 'M1',
      authorChatUserId: 'U_human',
      body: 'hi',
      db,
    });
    expect(r.kind).toBe('skipped_mode');
  });

  it('ignores encrypted pages', async () => {
    const s = await seedAll({ encryptedPage: true });
    const r = await ingestChannelMessage({
      installId: s.installId,
      channelId: 'C1',
      messageId: 'M1',
      authorChatUserId: 'U_human',
      body: 'hi',
      db,
    });
    expect(r.kind).toBe('skipped_encrypted');
  });

  it('returns link_not_found when the install id is unknown', async () => {
    const r = await ingestChannelMessage({
      installId: '00000000-0000-0000-0000-000000000000',
      channelId: 'C1',
      messageId: 'M1',
      authorChatUserId: 'U_human',
      body: 'hi',
      db,
    });
    expect(r.kind).toBe('link_not_found');
  });
});

describe('postCommentToChannels', () => {
  it('fans a comment out to every linked sync channel', async () => {
    const s = await seedAll();
    const calls: string[] = [];
    const r = await postCommentToChannels({
      workspaceId: s.workspaceId,
      pageId: s.pageId,
      body: 'hello channel',
      postFn: async (args) => {
        calls.push(`${args.platform}:${args.channelId}:${args.body}`);
      },
      db,
    });
    expect(r.posted).toBe(1);
    expect(calls).toEqual(['slack:C1:hello channel']);
  });

  it('skips encrypted pages', async () => {
    const s = await seedAll({ encryptedPage: true });
    const r = await postCommentToChannels({
      workspaceId: s.workspaceId,
      pageId: s.pageId,
      body: 'hi',
      postFn: async () => {
        throw new Error('should not call');
      },
      db,
    });
    expect(r.posted).toBe(0);
  });

  it('does not fan out to notify-mode links', async () => {
    const s = await seedAll({ linkMode: 'notify' });
    const calls: number = await (async () => {
      let n = 0;
      await postCommentToChannels({
        workspaceId: s.workspaceId,
        pageId: s.pageId,
        body: 'hi',
        postFn: async () => {
          n += 1;
        },
        db,
      });
      return n;
    })();
    expect(calls).toBe(0);
  });

  it('continues fan-out when a single post fn throws', async () => {
    const s = await seedAll();
    // Add a second link to a different channel on the same install.
    await db.execute(drizzleSql`
      INSERT INTO chat_channel_links
        (workspace_id, install_id, channel_id, page_id, link_mode, linked_by)
      VALUES
        (${s.workspaceId}::uuid, ${s.installId}::uuid, 'C2',
         ${s.pageId}::uuid, 'sync', ${s.userId}::uuid);
    `);
    let calls = 0;
    const r = await postCommentToChannels({
      workspaceId: s.workspaceId,
      pageId: s.pageId,
      body: 'hi',
      postFn: async (args) => {
        calls += 1;
        if (args.channelId === 'C1') throw new Error('flaky channel');
      },
      db,
    });
    expect(calls).toBe(2);
    expect(r.posted).toBe(1);
  });
});
