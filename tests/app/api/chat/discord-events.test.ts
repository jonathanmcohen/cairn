import { webcrypto } from 'node:crypto';
import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/chat/discord/events/route';
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

type Pair = { pubHex: string; priv: CryptoKey };

async function genPair(): Promise<Pair> {
  const pair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  return { pubHex: Buffer.from(raw).toString('hex'), priv: pair.privateKey };
}

async function signHex(priv: CryptoKey, msg: string): Promise<string> {
  const sig = new Uint8Array(
    await webcrypto.subtle.sign({ name: 'Ed25519' }, priv, new TextEncoder().encode(msg)),
  );
  return Buffer.from(sig).toString('hex');
}

async function seedDiscordInstall(
  pubHex: string,
): Promise<{ workspaceId: string; pageId: string }> {
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
    url: 'https://discord.com/api/webhooks/x/y?wait=true',
    events: ['page.created'],
    secret: 'whsec_discord',
    active: true,
    kind: 'discord',
    platformMetadata: { application_id: 'APP1', channel_id: 'C1', public_key: pubHex },
  });
  await recordPostedMessage(db, {
    workspaceId: u.workspaceId,
    pageId,
    platform: 'discord',
    channelId: 'C1',
    messageId: 'msg-parent',
  });
  return { workspaceId: u.workspaceId, pageId };
}

function req(body: object, headers: Record<string, string>): Request {
  return new Request('http://test.local/api/chat/discord/events', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat/discord/events', () => {
  it('responds with PONG when signature is valid + type=1', async () => {
    const pair = await genPair();
    await seedDiscordInstall(pair.pubHex);
    const ts = '1700000000';
    const body = { type: 1, application_id: 'APP1' };
    const raw = JSON.stringify(body);
    const sig = await signHex(pair.priv, ts + raw);
    const r = new Request('http://test.local/api/chat/discord/events', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'x-signature-timestamp': ts,
        'x-signature-ed25519': sig,
      }),
      body: raw,
    });
    const res = await POST(r);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { type?: number };
    expect(json.type).toBe(1);
  });

  it('400 + audit when signature is invalid', async () => {
    const pair = await genPair();
    const { workspaceId } = await seedDiscordInstall(pair.pubHex);
    const ts = '1700000000';
    const body = { type: 1, application_id: 'APP1' };
    const res = await POST(req(body, { 'x-signature-timestamp': ts, 'x-signature-ed25519': '00' }));
    expect(res.status).toBe(400);
    const audits = await db.select().from(schema.auditLog);
    expect(audits.some((a) => a.action === 'chat.signature_rejected')).toBe(true);
    expect(audits[0]?.workspaceId).toBe(workspaceId);
  });

  it('creates a comment when message_reference resolves to a posted-message row', async () => {
    const pair = await genPair();
    const { pageId } = await seedDiscordInstall(pair.pubHex);
    const ts = '1700000000';
    const body = {
      application_id: 'APP1',
      channel_id: 'C1',
      content: 'Reply from Discord',
      author: { id: 'U1', username: 'alice' },
      message_reference: { message_id: 'msg-parent' },
    };
    const raw = JSON.stringify(body);
    const sig = await signHex(pair.priv, ts + raw);
    const r = new Request('http://test.local/api/chat/discord/events', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'x-signature-timestamp': ts,
        'x-signature-ed25519': sig,
      }),
      body: raw,
    });
    const res = await POST(r);
    expect(res.status).toBe(200);
    const comments = await db.select().from(schema.comments);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.pageId).toBe(pageId);
    expect(comments[0]?.body).toContain('Reply from Discord');
    expect(comments[0]?.body).toContain('alice');
  });

  it('200 no-op when application_id matches no install', async () => {
    const res = await POST(req({ application_id: 'NOT_INSTALLED' }, {}));
    expect(res.status).toBe(200);
  });

  it('ignores bot loopback (author.bot === true)', async () => {
    const pair = await genPair();
    await seedDiscordInstall(pair.pubHex);
    const ts = '1700000000';
    const body = {
      application_id: 'APP1',
      channel_id: 'C1',
      content: 'echo',
      author: { id: 'B1', username: 'cairn', bot: true },
      message_reference: { message_id: 'msg-parent' },
    };
    const raw = JSON.stringify(body);
    const sig = await signHex(pair.priv, ts + raw);
    const r = new Request('http://test.local/api/chat/discord/events', {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'x-signature-timestamp': ts,
        'x-signature-ed25519': sig,
      }),
      body: raw,
    });
    const res = await POST(r);
    expect(res.status).toBe(200);
    const comments = await db.select().from(schema.comments);
    expect(comments).toHaveLength(0);
  });
});
