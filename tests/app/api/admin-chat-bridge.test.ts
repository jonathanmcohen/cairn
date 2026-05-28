import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import * as ssrf from '@/lib/webhooks/ssrf';
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

// Valid v4 UUIDs for Zod 4's strict UUID validator.
const U_ADMIN = '11111111-1111-4111-8111-111111111141';
const U_VIEWER = '11111111-1111-4111-8111-111111111142';
const W = '21111111-1111-4111-8111-111111111141';

beforeEach(async () => {
  await sql`TRUNCATE webhooks, audit_log, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
  await setUser(null);
  // SSRF always passes in the test (no real network calls).
  vi.spyOn(ssrf, 'assertPublicUrl').mockResolvedValue(undefined);
});

async function seedAdmin() {
  await sql.unsafe(`
    INSERT INTO users (id, email, password_hash, name)
      VALUES ('${U_ADMIN}', 'a@x', 'h', 'admin'), ('${U_VIEWER}', 'v@x', 'h', 'viewer');
    INSERT INTO workspaces (id, name, slug) VALUES ('${W}', 'WS', 'ws-${Date.now()}');
    INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ('${W}', '${U_ADMIN}', 'admin'), ('${W}', '${U_VIEWER}', 'viewer');
  `);
}

function jsonReq(method: 'POST' | 'DELETE', body: unknown): Request {
  return new Request('http://test/admin/chat-bridge', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/admin/chat-bridge', () => {
  it('401 without session', async () => {
    const { POST } = await import('@/app/api/admin/chat-bridge/route');
    const res = await POST(
      jsonReq('POST', {
        platform: 'slack',
        webhookUrl: 'https://hooks.slack.com/x/y/z',
        signingSecret: 'shh',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('403 for non-admin members', async () => {
    await seedAdmin();
    await setUser(U_VIEWER);
    const { POST } = await import('@/app/api/admin/chat-bridge/route');
    const res = await POST(
      jsonReq('POST', {
        platform: 'slack',
        webhookUrl: 'https://hooks.slack.com/x/y/z',
        signingSecret: 'shh',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('creates a Slack webhook on POST', async () => {
    await seedAdmin();
    await setUser(U_ADMIN);
    const { POST } = await import('@/app/api/admin/chat-bridge/route');
    const res = await POST(
      jsonReq('POST', {
        platform: 'slack',
        webhookUrl: 'https://hooks.slack.com/services/x/y/z',
        signingSecret: 'shh',
        teamId: 'T1',
        channelId: 'C1',
      }),
    );
    expect(res.status).toBe(200);
    const hooks = await db.select().from(schema.webhooks);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.kind).toBe('slack');
    expect(hooks[0]?.platformMetadata).toMatchObject({
      team_id: 'T1',
      channel_id: 'C1',
      signing_secret: 'shh',
    });
    const audits = await db.select().from(schema.auditLog);
    expect(audits.some((a) => a.action === 'chat.install_changed')).toBe(true);
  });

  it('upserts (updates the existing slack row on a second POST)', async () => {
    await seedAdmin();
    await setUser(U_ADMIN);
    const { POST } = await import('@/app/api/admin/chat-bridge/route');
    await POST(
      jsonReq('POST', {
        platform: 'slack',
        webhookUrl: 'https://hooks.slack.com/v1/x',
        signingSecret: 'shh1',
      }),
    );
    await POST(
      jsonReq('POST', {
        platform: 'slack',
        webhookUrl: 'https://hooks.slack.com/v2/x',
        signingSecret: 'shh2',
        channelId: 'C-NEW',
      }),
    );
    const hooks = await db.select().from(schema.webhooks).where(eq(schema.webhooks.kind, 'slack'));
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.url).toBe('https://hooks.slack.com/v2/x');
    expect((hooks[0]?.platformMetadata as { channel_id?: string } | null)?.channel_id).toBe(
      'C-NEW',
    );
  });

  it('rejects Slack POST without signingSecret', async () => {
    await seedAdmin();
    await setUser(U_ADMIN);
    const { POST } = await import('@/app/api/admin/chat-bridge/route');
    const res = await POST(
      jsonReq('POST', { platform: 'slack', webhookUrl: 'https://hooks.slack.com/x/y/z' }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects Discord POST without publicKey', async () => {
    await seedAdmin();
    await setUser(U_ADMIN);
    const { POST } = await import('@/app/api/admin/chat-bridge/route');
    const res = await POST(
      jsonReq('POST', { platform: 'discord', webhookUrl: 'https://discord.com/api/webhooks/x/y' }),
    );
    expect(res.status).toBe(400);
  });

  it('removes the install on DELETE + writes a chat.install_changed audit', async () => {
    await seedAdmin();
    await setUser(U_ADMIN);
    const { POST, DELETE } = await import('@/app/api/admin/chat-bridge/route');
    await POST(
      jsonReq('POST', {
        platform: 'slack',
        webhookUrl: 'https://hooks.slack.com/x/y/z',
        signingSecret: 'shh',
      }),
    );
    const res = await DELETE(jsonReq('DELETE', { platform: 'slack' }));
    expect(res.status).toBe(200);
    const hooks = await db.select().from(schema.webhooks).where(eq(schema.webhooks.kind, 'slack'));
    expect(hooks).toHaveLength(0);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'chat.install_changed'));
    expect(audits.some((a) => (a.metadata as { op?: string } | null)?.op === 'deleted')).toBe(true);
  });
});
