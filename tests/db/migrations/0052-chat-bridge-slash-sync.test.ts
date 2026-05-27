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

describe('migration 0052 — chat bridge slash + channel sync', () => {
  it('creates chat_bridge_installs with the expected columns', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'chat_bridge_installs' ORDER BY column_name
    `)) as unknown as Array<{ column_name: string }>;
    const cols = rows.map((r) => r.column_name);
    for (const expected of [
      'id',
      'workspace_id',
      'platform',
      'team_id',
      'bot_token',
      'signing_secret',
      'installed_by',
      'installed_at',
      'options',
    ]) {
      expect(cols).toContain(expected);
    }
  });

  it('creates chat_channel_links with the expected columns', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'chat_channel_links' ORDER BY column_name
    `)) as unknown as Array<{ column_name: string }>;
    const cols = rows.map((r) => r.column_name);
    for (const expected of [
      'id',
      'workspace_id',
      'install_id',
      'channel_id',
      'page_id',
      'link_mode',
      'linked_by',
      'linked_at',
    ]) {
      expect(cols).toContain(expected);
    }
  });

  it('adds chat_message_id column on comments', async () => {
    const rows = (await db.execute(drizzleSql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'comments' AND column_name = 'chat_message_id'
    `)) as unknown as unknown[];
    expect(rows.length).toBe(1);
  });

  it('enforces the platform CHECK constraint on chat_bridge_installs', async () => {
    // Seed workspace + user so the FKs are satisfied.
    await db.execute(drizzleSql`
      INSERT INTO workspaces (id, name, slug, created_at)
      VALUES ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01', 'w', 'w-0052-1', now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await db.execute(drizzleSql`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES ('cc1ccccc-cccc-cccc-cccc-cccccccccd01',
              'u-0052@example.com', 'u', 'placeholder', now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await expect(
      db.execute(drizzleSql`
        INSERT INTO chat_bridge_installs
          (workspace_id, platform, team_id, bot_token, signing_secret, installed_by)
        VALUES
          ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01'::uuid, 'bogus', 'T1', 'x', 'y',
           'cc1ccccc-cccc-cccc-cccc-cccccccccd01'::uuid);
      `),
    ).rejects.toThrow();
  });

  it('enforces the link_mode CHECK constraint on chat_channel_links', async () => {
    await db.execute(drizzleSql`
      INSERT INTO workspaces (id, name, slug, created_at)
      VALUES ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaab02', 'w', 'w-0052-2', now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await db.execute(drizzleSql`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES ('cc1ccccc-cccc-cccc-cccc-cccccccccd02',
              'u-0052-2@example.com', 'u', 'placeholder', now())
      ON CONFLICT (id) DO NOTHING;
    `);
    await db.execute(drizzleSql`
      INSERT INTO pages (id, workspace_id, title, content, created_by, created_at, updated_at)
      VALUES ('bb1bbbbb-bbbb-bbbb-bbbb-bbbbbbbbbc02',
              'aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaab02'::uuid,
              't', '{}'::jsonb,
              'cc1ccccc-cccc-cccc-cccc-cccccccccd02'::uuid,
              now(), now())
      ON CONFLICT (id) DO NOTHING;
    `);
    const installRow = (await db.execute(drizzleSql`
      INSERT INTO chat_bridge_installs
        (workspace_id, platform, team_id, bot_token, signing_secret, installed_by)
      VALUES
        ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaab02'::uuid, 'slack', 'T2', 'x', 'y',
         'cc1ccccc-cccc-cccc-cccc-cccccccccd02'::uuid)
      RETURNING id;
    `)) as unknown as Array<{ id: string }>;
    const installId = installRow[0]?.id;
    expect(installId).toBeTruthy();
    await expect(
      db.execute(drizzleSql`
        INSERT INTO chat_channel_links
          (workspace_id, install_id, channel_id, page_id, link_mode, linked_by)
        VALUES
          ('aa1aaaaa-aaaa-aaaa-aaaa-aaaaaaaaab02'::uuid,
           ${installId}::uuid, 'C1',
           'bb1bbbbb-bbbb-bbbb-bbbb-bbbbbbbbbc02'::uuid,
           'badmode',
           'cc1ccccc-cccc-cccc-cccc-cccccccccd02'::uuid);
      `),
    ).rejects.toThrow();
  });
});
