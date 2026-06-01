import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { signOauthState } from '@/lib/chat/oauth-state';
import { openBotToken } from '@/lib/chat/oauth-token';
import { startPostgres, stopPostgres } from '../helpers/db';

let sql: ReturnType<typeof postgres>;

vi.mock('@/lib/chat/oauth-exchange', () => ({
  exchangeCode: vi.fn(async () => ({
    botToken: 'xoxb-secret',
    externalTeamId: 'T-INSTALL',
    scopes: ['chat:write'],
  })),
}));

vi.mock('@/lib/url', () => ({ publicOrigin: vi.fn(async () => 'https://c.example.com') }));

// requireRole returns the seeded admin's workspace/user via a mutable holder so
// each test can rebind it after inserting the ws/user rows.
let activeCtx: { userId: string; workspaceId: string; role: 'admin' } | null = null;
vi.mock('@/lib/auth/require-role', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/require-role')>('@/lib/auth/require-role');
  return {
    ...actual,
    requireRole: vi.fn(async () => {
      if (!activeCtx) throw new actual.HttpError(401, 'no session');
      return activeCtx;
    }),
  };
});

describe('GET chat-bridge oauth callback (slack)', () => {
  beforeAll(async () => {
    const uri = await startPostgres();
    await runMigrations(uri);
    sql = postgres(uri);
    process.env.DATABASE_URL = uri;
  });
  afterAll(async () => {
    await sql.end();
    await stopPostgres();
  });
  beforeEach(async () => {
    await sql`TRUNCATE chat_oauth_installs, workspace_members, workspaces, users RESTART IDENTITY CASCADE`;
    process.env.AUTH_SECRET = 'a'.repeat(40);
    process.env.CAIRN_SLACK_CLIENT_ID = 'CID';
    process.env.CAIRN_SLACK_CLIENT_SECRET = 'SEC';
    process.env.WEBHOOK_ALLOW_PRIVATE = '1';
    activeCtx = null;
  });

  it('verifies state, exchanges, seals the token and persists the install', async () => {
    const db = getDb();
    const [ws] = await db.insert(schema.workspaces).values({ name: 'W', slug: 'w-cb' }).returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'a@b.c', name: 'A', passwordHash: 'x' })
      .returning();
    activeCtx = { userId: user.id, workspaceId: ws.id, role: 'admin' };
    const state = await signOauthState({ workspaceId: ws.id, platform: 'slack', nonce: 'n' });
    const { GET } = await import('@/app/api/admin/chat-bridge/oauth/slack/callback/route');
    const res = await GET(
      new Request(
        `https://c.example.com/api/admin/chat-bridge/oauth/slack/callback?code=C&state=${state}`,
      ),
    );
    expect(res.status).toBe(307);

    const [row] = await db
      .select()
      .from(schema.chatOauthInstalls)
      .where(eq(schema.chatOauthInstalls.workspaceId, ws.id));
    expect(row.externalTeamId).toBe('T-INSTALL');
    expect(openBotToken(row.botTokenEncrypted)).toBe('xoxb-secret');
    expect(row.scopes).toEqual(['chat:write']);
  });

  it('rejects a tampered/missing state with 400', async () => {
    const { GET } = await import('@/app/api/admin/chat-bridge/oauth/slack/callback/route');
    const res = await GET(
      new Request(
        'https://c.example.com/api/admin/chat-bridge/oauth/slack/callback?code=C&state=bogus',
      ),
    );
    expect(res.status).toBe(400);
  });
});
