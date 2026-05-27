import { sql as drizzleSql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { resetRateLimitForTests } from '@/lib/chat/ratelimit';
import { startPostgres, stopPostgres } from '../../../helpers/db';
import { makeDiscordKeypair } from '../../../helpers/discord-sig';
import { createTestWorkspaceWithUser } from '../../../helpers/fixtures';

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
  applicationId: string;
  kp: Awaited<ReturnType<typeof makeDiscordKeypair>>;
};

async function seedInstall(): Promise<Seed> {
  const u = await createTestWorkspaceWithUser(db);
  const kp = await makeDiscordKeypair();
  const applicationId = 'A_SLASH';
  const rows = (await db.execute(drizzleSql`
    INSERT INTO chat_bridge_installs
      (workspace_id, platform, team_id, bot_token, signing_secret, installed_by)
    VALUES
      (${u.workspaceId}::uuid, 'discord', ${applicationId}, 'bot-stub', ${kp.publicKeyHex},
       ${u.userId}::uuid)
    RETURNING id;
  `)) as unknown as Array<{ id: string }>;
  return {
    workspaceId: u.workspaceId,
    userId: u.userId,
    installId: rows[0]!.id,
    applicationId,
    kp,
  };
}

async function makeSignedReq(s: Seed, body: unknown): Promise<Request> {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await s.kp.sign(ts, raw);
  return new Request('http://test/api/chat/discord/interactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': sig,
      'x-signature-timestamp': ts,
    },
    body: raw,
  });
}

describe('POST /api/chat/discord/interactions', () => {
  it('401 on missing application_id', async () => {
    const { POST } = await import('@/app/api/chat/discord/interactions/route');
    const res = await POST(
      new Request('http://test/api/chat/discord/interactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 1 }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('401 on signature mismatch', async () => {
    const s = await seedInstall();
    const { POST } = await import('@/app/api/chat/discord/interactions/route');
    const raw = JSON.stringify({ type: 1, application_id: s.applicationId });
    const res = await POST(
      new Request('http://test/api/chat/discord/interactions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature-ed25519': 'cafebabe',
          'x-signature-timestamp': String(Math.floor(Date.now() / 1000)),
        },
        body: raw,
      }),
    );
    expect(res.status).toBe(401);
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'chat.signature_rejected'));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('responds with PONG to a verified type=1 ping', async () => {
    const s = await seedInstall();
    const { POST } = await import('@/app/api/chat/discord/interactions/route');
    const req = await makeSignedReq(s, { type: 1, application_id: s.applicationId });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { type: number };
    expect(payload.type).toBe(1);
  });

  it('creates a page for /cairn create-page Foo bar', async () => {
    const s = await seedInstall();
    const { POST } = await import('@/app/api/chat/discord/interactions/route');
    const req = await makeSignedReq(s, {
      type: 2,
      application_id: s.applicationId,
      channel_id: 'C1',
      member: { user: { id: 'U_discord' } },
      data: {
        name: 'cairn',
        options: [
          {
            name: 'create-page',
            options: [{ name: 'title', value: 'Foo bar' }],
          },
        ],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { type: number; data: { content: string; flags: number } };
    expect(payload.type).toBe(4);
    expect(payload.data.flags).toBe(64);
    expect(payload.data.content).toMatch(/created.+Foo bar/i);
    const pages = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.workspaceId, s.workspaceId));
    expect(pages.find((p) => p.title === 'Foo bar')).toBeTruthy();
  });

  it('returns ephemeral "no results" for /cairn search foo with no hits', async () => {
    const s = await seedInstall();
    const { POST } = await import('@/app/api/chat/discord/interactions/route');
    const req = await makeSignedReq(s, {
      type: 2,
      application_id: s.applicationId,
      channel_id: 'C1',
      member: { user: { id: 'U_discord' } },
      data: {
        name: 'cairn',
        options: [
          {
            name: 'search',
            options: [{ name: 'query', value: 'foo' }],
          },
        ],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { type: number; data: { content: string } };
    expect(payload.data.content).toMatch(/no results/i);
  });
});
