import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { startPostgres, stopPostgres } from '../../helpers/db';

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

describe('migration 0051 — chat-bridge-p36', () => {
  it('adds webhooks.kind with default generic + webhooks.platform_metadata', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'webhooks' AND column_name IN ('kind', 'platform_metadata')
      ORDER BY column_name;
    `)) as unknown as Array<{
      column_name: string;
      data_type: string;
      column_default: string | null;
    }>;
    expect(cols.map((c) => c.column_name).sort()).toEqual(['kind', 'platform_metadata']);
    const kind = cols.find((c) => c.column_name === 'kind');
    expect(kind?.data_type).toBe('text');
    expect(kind?.column_default).toContain("'generic'");
    const meta = cols.find((c) => c.column_name === 'platform_metadata');
    expect(meta?.data_type).toBe('jsonb');
  });

  it('enforces the kind CHECK constraint (rejects an unknown value)', async () => {
    // Seed a workspace so the FK is satisfied.
    await db.execute(drizzleSql`
      INSERT INTO workspaces (id, name, slug, created_at)
      VALUES ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'w', 'w-0051-chk-1', now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await expect(
      db.execute(drizzleSql`
        INSERT INTO webhooks (id, workspace_id, url, events, secret, active, kind, created_at)
        VALUES (gen_random_uuid(),
                'aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'::uuid,
                'https://example.com', ARRAY['page.created']::text[], 'whsec_x', true,
                'bogus', now());
      `),
    ).rejects.toThrow();
  });

  it('accepts kind=slack and kind=discord', async () => {
    await db.execute(drizzleSql`
      INSERT INTO workspaces (id, name, slug, created_at)
      VALUES ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'w', 'w-0051-chk-2', now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await db.execute(drizzleSql`
      INSERT INTO webhooks (id, workspace_id, url, events, secret, active, kind, created_at)
      VALUES (gen_random_uuid(),
              'aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'::uuid,
              'https://example.com', ARRAY['page.created']::text[], 'whsec_x', true,
              'slack', now()),
             (gen_random_uuid(),
              'aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'::uuid,
              'https://example.com', ARRAY['page.created']::text[], 'whsec_y', true,
              'discord', now());
    `);
    const rows = (await db.execute(drizzleSql`
      SELECT kind FROM webhooks
      WHERE workspace_id = 'aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'::uuid
      ORDER BY kind;
    `)) as unknown as Array<{ kind: string }>;
    expect(rows.map((r) => r.kind)).toEqual(['discord', 'slack']);
  });

  it('creates chat_posted_messages with the expected columns', async () => {
    const cols = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'chat_posted_messages'
      ORDER BY column_name;
    `)) as unknown as Array<{ column_name: string }>;
    const names = cols.map((c) => c.column_name);
    for (const expected of [
      'id',
      'workspace_id',
      'platform',
      'channel_id',
      'message_id',
      'thread_ts',
      'page_id',
      'parent_comment_id',
      'metadata',
      'created_at',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('chat_posted_messages_thread_unique enforces uniqueness on (platform, channel, thread_ts)', async () => {
    // Seed workspace + user + page (pages.created_by is NOT NULL).
    await db.execute(drizzleSql`
      INSERT INTO workspaces (id, name, slug, created_at)
      VALUES ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03', 'w', 'w-0051-pm-1', now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await db.execute(drizzleSql`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES ('cc1ccccc-cccc-cccc-cccc-cccccccccc03',
              'u-0051@example.com', 'u', 'placeholder', now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await db.execute(drizzleSql`
      INSERT INTO pages (id, workspace_id, title, content, created_by, created_at, updated_at)
      VALUES ('bb1bbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03',
              'aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'::uuid,
              't', '{}'::jsonb,
              'cc1ccccc-cccc-cccc-cccc-cccccccccc03'::uuid,
              now(), now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await db.execute(drizzleSql`
      INSERT INTO chat_posted_messages
        (workspace_id, platform, channel_id, message_id, thread_ts, page_id, created_at)
      VALUES
        ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'::uuid, 'slack', 'C1', '1700000000.000100',
         '1700000000.000100',
         'bb1bbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03'::uuid, now());
    `);
    await expect(
      db.execute(drizzleSql`
        INSERT INTO chat_posted_messages
          (workspace_id, platform, channel_id, message_id, thread_ts, page_id, created_at)
        VALUES
          ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03'::uuid, 'slack', 'C1', '1700000000.000200',
           '1700000000.000100',
           'bb1bbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb03'::uuid, now());
      `),
    ).rejects.toThrow();
  });
});
