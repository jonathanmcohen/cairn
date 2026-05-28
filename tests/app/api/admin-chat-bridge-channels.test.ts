import { sql as drizzleSql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  process.env.DATABASE_URL = uri;
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

vi.mock('@/lib/auth/config', () => {
  let ctx: { userId: string } | null = null;
  return {
    auth: async () => (ctx ? { user: { id: ctx.userId } } : null),
    __set: (c: { userId: string } | null) => {
      ctx = c;
    },
  };
});

async function setUser(userId: string | null) {
  const mod = (await import('@/lib/auth/config')) as unknown as {
    __set: (c: { userId: string } | null) => void;
  };
  mod.__set(userId ? { userId } : null);
}

const U_ADMIN = '11111111-1111-4111-8111-111111111143';
const U_VIEWER = '11111111-1111-4111-8111-111111111144';
const W = '21111111-1111-4111-8111-111111111143';
const P = '31111111-1111-4111-8111-111111111143';

beforeEach(async () => {
  await sql`TRUNCATE chat_channel_links, chat_bridge_installs, audit_log, pages, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await setUser(null);
});

async function seed() {
  await sql.unsafe(`
    INSERT INTO users (id, email, password_hash, name)
      VALUES ('${U_ADMIN}', 'a@x', 'h', 'admin'), ('${U_VIEWER}', 'v@x', 'h', 'viewer');
    INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'WS', 'ws-${Date.now()}');
    INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ('${W}', '${U_ADMIN}', 'admin'), ('${W}', '${U_VIEWER}', 'viewer');
    INSERT INTO pages (id, workspace_id, title, content, created_by, created_at, updated_at)
      VALUES ('${P}', '${W}', 't', '{}'::jsonb, '${U_ADMIN}', now(), now());
  `);
  const rows = (await db.execute(drizzleSql`
    INSERT INTO chat_bridge_installs
      (workspace_id, platform, team_id, bot_token, signing_secret, installed_by)
    VALUES
      (${W}::uuid, 'slack', 'T_admin', 'xoxb', 'shh', ${U_ADMIN}::uuid)
    RETURNING id;
  `)) as unknown as Array<{ id: string }>;
  return { installId: rows[0]!.id };
}

function jsonReq(method: 'POST' | 'DELETE', body: unknown): Request {
  return new Request('http://test/admin/chat-bridge/channels', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/admin/chat-bridge/channels', () => {
  it('401 without session', async () => {
    const { POST } = await import('@/app/api/admin/chat-bridge/channels/route');
    const res = await POST(
      jsonReq('POST', {
        installId: '00000000-0000-0000-0000-000000000000',
        channelId: 'C1',
        pageId: '00000000-0000-0000-0000-000000000000',
        linkMode: 'sync',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('403 for non-admin', async () => {
    const { installId } = await seed();
    await setUser(U_VIEWER);
    const { POST } = await import('@/app/api/admin/chat-bridge/channels/route');
    const res = await POST(
      jsonReq('POST', {
        installId,
        channelId: 'C1',
        pageId: P,
        linkMode: 'sync',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('creates a link + writes chat.channel_linked audit', async () => {
    const { installId } = await seed();
    await setUser(U_ADMIN);
    const { POST } = await import('@/app/api/admin/chat-bridge/channels/route');
    const res = await POST(
      jsonReq('POST', {
        installId,
        channelId: 'C1',
        pageId: P,
        linkMode: 'sync',
      }),
    );
    expect(res.status).toBe(200);
    const links = await db.select().from(schema.chatChannelLinks);
    expect(links).toHaveLength(1);
    expect(links[0]?.channelId).toBe('C1');
    expect(links[0]?.linkMode).toBe('sync');
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'chat.channel_linked'));
    expect(audits.length).toBe(1);
  });

  it('rejects an install from another workspace', async () => {
    const { installId: _ } = await seed();
    // Make a second workspace + install
    const W2 = '21111111-1111-4111-8111-111111111144';
    await sql.unsafe(`
      INSERT INTO workspaces (id, name, slug) VALUES ('${W2}', 'WS2', 'ws-2-${Date.now()}');
    `);
    const otherRows = (await db.execute(drizzleSql`
      INSERT INTO chat_bridge_installs
        (workspace_id, platform, team_id, bot_token, signing_secret, installed_by)
      VALUES
        (${W2}::uuid, 'slack', 'T_other', 'xoxb', 'shh', ${U_ADMIN}::uuid)
      RETURNING id;
    `)) as unknown as Array<{ id: string }>;
    await setUser(U_ADMIN);
    const { POST } = await import('@/app/api/admin/chat-bridge/channels/route');
    const res = await POST(
      jsonReq('POST', {
        installId: otherRows[0]!.id,
        channelId: 'C1',
        pageId: P,
        linkMode: 'sync',
      }),
    );
    expect(res.status).toBe(404);
  });

  it('removes a link + writes chat.channel_unlinked audit', async () => {
    const { installId } = await seed();
    await setUser(U_ADMIN);
    const { POST, DELETE } = await import('@/app/api/admin/chat-bridge/channels/route');
    const createRes = await POST(
      jsonReq('POST', {
        installId,
        channelId: 'C1',
        pageId: P,
        linkMode: 'notify',
      }),
    );
    const { id } = (await createRes.json()) as { id: string };
    const res = await DELETE(jsonReq('DELETE', { id }));
    expect(res.status).toBe(200);
    const links = await db.select().from(schema.chatChannelLinks);
    expect(links).toHaveLength(0);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'chat.channel_unlinked'));
    expect(audits.length).toBe(1);
  });

  it('rejects invalid link_mode', async () => {
    const { installId } = await seed();
    await setUser(U_ADMIN);
    const { POST } = await import('@/app/api/admin/chat-bridge/channels/route');
    const res = await POST(
      jsonReq('POST', {
        installId,
        channelId: 'C1',
        pageId: P,
        linkMode: 'bogus',
      }),
    );
    expect(res.status).toBe(400);
  });
});
