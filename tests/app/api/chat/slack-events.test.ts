import { createHmac } from 'node:crypto';
import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/chat/slack/events/route';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { recordPostedMessage } from '@/lib/chat/posted-log';
import { startPostgres, stopPostgres } from '../../../helpers/db';
import { createTestWorkspaceWithUser } from '../../../helpers/fixtures';

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
  await sql`TRUNCATE chat_posted_messages, comments, audit_log, webhooks, pages, workspace_members, users, workspaces RESTART IDENTITY CASCADE`;
});

function slackSign(secret: string, ts: string, body: string): string {
  const base = `v0:${ts}:${body}`;
  return `v0=${createHmac('sha256', secret).update(base).digest('hex')}`;
}

async function seedSlackInstall(): Promise<{ workspaceId: string; pageId: string }> {
  const u = await createTestWorkspaceWithUser(db);
  const rows = (await db.execute(drizzleSql`
    INSERT INTO pages (id, workspace_id, title, content, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), ${u.workspaceId}::uuid, 't', '{}'::jsonb,
            ${u.userId}::uuid, now(), now())
    RETURNING id;
  `)) as unknown as Array<{ id: string }>;
  const pageId = rows[0]!.id;
  await db.insert(schema.webhooks).values({
    workspaceId: u.workspaceId,
    url: 'https://hooks.slack.com/services/x/y/z',
    events: ['page.created'],
    secret: 'whsec_slack',
    active: true,
    kind: 'slack',
    platformMetadata: { team_id: 'T1', channel_id: 'C1', signing_secret: 'shh' },
  });
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

function makeRequest(body: object, opts: { sig?: string; ts?: string } = {}): Request {
  const raw = JSON.stringify(body);
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.sig) headers.set('x-slack-signature', opts.sig);
  if (opts.ts) headers.set('x-slack-request-timestamp', opts.ts);
  return new Request('http://test.local/api/chat/slack/events', {
    method: 'POST',
    headers,
    body: raw,
  });
}

describe('POST /api/chat/slack/events', () => {
  it('responds to the url_verification challenge before any DB lookup', async () => {
    const res = await POST(makeRequest({ type: 'url_verification', challenge: 'C123' }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { challenge?: string };
    expect(json.challenge).toBe('C123');
  });

  it('returns 200 ok when no matching team_id (silent no-op)', async () => {
    const res = await POST(makeRequest({ team_id: 'T_UNKNOWN', event: {} }));
    expect(res.status).toBe(200);
  });

  it('returns 400 + audits on invalid signature when team_id matches', async () => {
    const { workspaceId } = await seedSlackInstall();
    const body = { team_id: 'T1', event: { type: 'message' } };
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await POST(makeRequest(body, { sig: 'v0=DEADBEEF', ts }));
    expect(res.status).toBe(400);
    const audits = await db.select().from(schema.auditLog);
    expect(audits.some((a) => a.action === 'chat.signature_rejected')).toBe(true);
    expect(audits.find((a) => a.action === 'chat.signature_rejected')?.workspaceId).toBe(
      workspaceId,
    );
  });

  it('creates a Cairn comment when sig + thread match a posted-message row', async () => {
    const { workspaceId, pageId } = await seedSlackInstall();
    const ts = String(Math.floor(Date.now() / 1000));
    const body = {
      team_id: 'T1',
      event: {
        type: 'message',
        text: 'Hello from Slack',
        user: 'U1',
        channel: 'C1',
        thread_ts: '1700000000.000100',
      },
    };
    const raw = JSON.stringify(body);
    const sig = slackSign('shh', ts, raw);
    const headers = new Headers({
      'content-type': 'application/json',
      'x-slack-signature': sig,
      'x-slack-request-timestamp': ts,
    });
    const req = new Request('http://test.local/api/chat/slack/events', {
      method: 'POST',
      headers,
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const comments = await db.select().from(schema.comments);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.pageId).toBe(pageId);
    expect(comments[0]?.workspaceId).toBe(workspaceId);
    expect(comments[0]?.body).toContain('Hello from Slack');
  });

  it('200 no-op when sig is valid but no matching posted-message row', async () => {
    await seedSlackInstall();
    const ts = String(Math.floor(Date.now() / 1000));
    const body = {
      team_id: 'T1',
      event: {
        type: 'message',
        text: 'orphan',
        user: 'U1',
        channel: 'C-other',
        thread_ts: 'nope',
      },
    };
    const raw = JSON.stringify(body);
    const sig = slackSign('shh', ts, raw);
    const req = new Request('http://test.local/api/chat/slack/events', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'x-slack-signature': sig,
        'x-slack-request-timestamp': ts,
      }),
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const comments = await db.select().from(schema.comments);
    expect(comments).toHaveLength(0);
  });

  it('rejects bot loopback (event.bot_id present)', async () => {
    const { pageId } = await seedSlackInstall();
    void pageId;
    const ts = String(Math.floor(Date.now() / 1000));
    const body = {
      team_id: 'T1',
      event: {
        type: 'message',
        text: 'echo',
        user: 'U1',
        channel: 'C1',
        thread_ts: '1700000000.000100',
        bot_id: 'B1',
      },
    };
    const raw = JSON.stringify(body);
    const sig = slackSign('shh', ts, raw);
    const req = new Request('http://test.local/api/chat/slack/events', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'x-slack-signature': sig,
        'x-slack-request-timestamp': ts,
      }),
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const comments = await db.select().from(schema.comments);
    expect(comments).toHaveLength(0);
  });
});
