import { sql as drizzleSql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { resetRateLimitForTests } from '@/lib/chat/ratelimit';
import { startPostgres, stopPostgres } from '../../../helpers/db';
import { createTestWorkspaceWithUser } from '../../../helpers/fixtures';
import { signSlack } from '../../../helpers/slack-sig';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const uri = await startPostgres();
  await runMigrations(uri);
  sql = postgres(uri);
  db = drizzle(sql, { schema });
  process.env.DATABASE_URL = uri;
  process.env.PUBLIC_URL = 'https://cairn.test';
});
afterAll(async () => {
  await sql.end();
  await stopPostgres();
});
beforeEach(async () => {
  await sql`TRUNCATE chat_channel_links, chat_bridge_installs, comments, pages, audit_log, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
  resetRateLimitForTests();
});

type Seed = {
  workspaceId: string;
  userId: string;
  installId: string;
  teamId: string;
  signingSecret: string;
};

async function seedInstall(): Promise<Seed> {
  const u = await createTestWorkspaceWithUser(db);
  const signingSecret = 'test-signing-secret';
  const teamId = 'T_SLASH';
  const rows = (await db.execute(drizzleSql`
    INSERT INTO chat_bridge_installs
      (workspace_id, platform, team_id, bot_token, signing_secret, installed_by)
    VALUES
      (${u.workspaceId}::uuid, 'slack', ${teamId}, 'xoxb-stub', ${signingSecret},
       ${u.userId}::uuid)
    RETURNING id;
  `)) as unknown as Array<{ id: string }>;
  return {
    workspaceId: u.workspaceId,
    userId: u.userId,
    installId: rows[0]!.id,
    teamId,
    signingSecret,
  };
}

function makeReq(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://test/api/chat/slack/commands', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body,
  });
}

describe('POST /api/chat/slack/commands', () => {
  it('401 on missing team_id', async () => {
    const { POST } = await import('@/app/api/chat/slack/commands/route');
    const res = await POST(makeReq('text=search+hello'));
    expect(res.status).toBe(401);
  });

  it('401 on missing signature headers', async () => {
    const s = await seedInstall();
    const { POST } = await import('@/app/api/chat/slack/commands/route');
    const body = new URLSearchParams({ team_id: s.teamId, text: 'search foo' }).toString();
    const res = await POST(makeReq(body));
    expect(res.status).toBe(401);
  });

  it('401 on signature mismatch', async () => {
    const s = await seedInstall();
    const { POST } = await import('@/app/api/chat/slack/commands/route');
    const body = new URLSearchParams({ team_id: s.teamId, text: 'search foo' }).toString();
    const sig = signSlack(body, 'wrong-secret');
    const res = await POST(
      makeReq(body, {
        'x-slack-request-timestamp': sig.ts,
        'x-slack-signature': sig.v0,
      }),
    );
    expect(res.status).toBe(401);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'chat.signature_rejected'));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('200 + ephemeral "no results" for "search foo" with no matches', async () => {
    const s = await seedInstall();
    const { POST } = await import('@/app/api/chat/slack/commands/route');
    const body = new URLSearchParams({
      team_id: s.teamId,
      text: 'search foo',
      user_id: 'U1',
      channel_id: 'C1',
    }).toString();
    const sig = signSlack(body, s.signingSecret);
    const res = await POST(
      makeReq(body, {
        'x-slack-request-timestamp': sig.ts,
        'x-slack-signature': sig.v0,
      }),
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { response_type: string; text: string };
    expect(payload.response_type).toBe('ephemeral');
    expect(payload.text).toMatch(/no results/i);
  });

  it('200 + creates a page for "create page Foo bar"', async () => {
    const s = await seedInstall();
    const { POST } = await import('@/app/api/chat/slack/commands/route');
    const body = new URLSearchParams({
      team_id: s.teamId,
      text: 'create page Foo bar',
      user_id: 'U1',
      channel_id: 'C1',
    }).toString();
    const sig = signSlack(body, s.signingSecret);
    const res = await POST(
      makeReq(body, {
        'x-slack-request-timestamp': sig.ts,
        'x-slack-signature': sig.v0,
      }),
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { text: string };
    expect(payload.text).toMatch(/created.+Foo bar/i);
    const pages = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.workspaceId, s.workspaceId));
    expect(pages.find((p) => p.title === 'Foo bar')).toBeTruthy();
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'chat.slash_invoked'));
    expect(audits.length).toBe(1);
    expect((audits[0]?.metadata as { command?: string } | null)?.command).toBe('create_page');
  });

  it('200 + error payload for unknown subcommand', async () => {
    const s = await seedInstall();
    const { POST } = await import('@/app/api/chat/slack/commands/route');
    const body = new URLSearchParams({
      team_id: s.teamId,
      text: 'frobnicate',
      user_id: 'U1',
    }).toString();
    const sig = signSlack(body, s.signingSecret);
    const res = await POST(
      makeReq(body, {
        'x-slack-request-timestamp': sig.ts,
        'x-slack-signature': sig.v0,
      }),
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { text: string };
    expect(payload.text).toMatch(/unknown/i);
  });
});
