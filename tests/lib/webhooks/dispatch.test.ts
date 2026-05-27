import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { canonicalBody, deliver, emit } from '@/lib/webhooks/dispatch';
import { verifySignature } from '@/lib/webhooks/sign';
import * as ssrf from '@/lib/webhooks/ssrf';
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
  await sql`TRUNCATE webhooks, webhook_deliveries, chat_posted_messages, pages, workspaces, users, workspace_members RESTART IDENTITY CASCADE`;
  // SSRF guard always passes in unit tests (we don't make real network calls).
  vi.spyOn(ssrf, 'assertPublicUrl').mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

async function makeHook(workspaceId: string, events: string[], active = true) {
  const [w] = await db
    .insert(schema.webhooks)
    .values({ workspaceId, url: 'https://example.com/hook', events, secret: 'whsec_x', active })
    .returning();
  if (!w) throw new Error('hook insert failed');
  return w;
}

describe('webhook dispatch', () => {
  it('emit inserts a pending delivery per subscribed active hook and skips others', async () => {
    const u = await createTestWorkspaceWithUser(db);
    await makeHook(u.workspaceId, ['page.created']); // subscribed
    await makeHook(u.workspaceId, ['row.created']); // not subscribed to this event
    await makeHook(u.workspaceId, ['page.created'], false); // inactive

    await emit('page.created', u.workspaceId, { id: 'p1' });

    const rows = await db.select().from(schema.webhookDeliveries);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.event).toBe('page.created');
  });

  it('deliver POSTs a signed body and marks success on 2xx', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const hook = await makeHook(u.workspaceId, ['page.updated']);
    const [d] = await db
      .insert(schema.webhookDeliveries)
      .values({
        webhookId: hook.id,
        event: 'page.updated',
        payload: { id: 'p1' },
        status: 'pending',
      })
      .returning();
    if (!d) throw new Error('delivery insert failed');

    const seen: { body: string; sig: string | null } = { body: '', sig: null };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      seen.body = init.body as string;
      seen.sig = new Headers(init.headers).get('X-Cairn-Signature');
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await deliver(d.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(verifySignature('whsec_x', seen.body, seen.sig ?? '')).toBe(true);
    const [after] = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, d.id));
    expect(after?.status).toBe('success');
    expect(after?.attempts).toBe(1);
    expect(after?.lastStatus).toBe(200);
    expect(after?.deliveredAt).not.toBeNull();
  });

  it('deliver retries up to 3 attempts then marks failed', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const hook = await makeHook(u.workspaceId, ['page.deleted']);
    const [d] = await db
      .insert(schema.webhookDeliveries)
      .values({
        webhookId: hook.id,
        event: 'page.deleted',
        payload: { id: 'p1' },
        status: 'pending',
      })
      .returning();
    if (!d) throw new Error('delivery insert failed');

    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    // backoff is real but tiny in tests via the injected delay hook
    await deliver(d.id, { delayMs: () => 0 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [after] = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, d.id));
    expect(after?.status).toBe('failed');
    expect(after?.attempts).toBe(3);
    expect(after?.lastStatus).toBe(500);
    expect(after?.deliveredAt).toBeNull();
  });

  it('deliver records a failure (no last_status) when the SSRF guard rejects', async () => {
    const u = await createTestWorkspaceWithUser(db);
    const hook = await makeHook(u.workspaceId, ['row.created']);
    const [d] = await db
      .insert(schema.webhookDeliveries)
      .values({ webhookId: hook.id, event: 'row.created', payload: {}, status: 'pending' })
      .returning();
    if (!d) throw new Error('delivery insert failed');
    vi.spyOn(ssrf, 'assertPublicUrl').mockRejectedValue(new Error('Refusing webhook URL: private'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await deliver(d.id, { delayMs: () => 0 });

    expect(fetchMock).not.toHaveBeenCalled();
    const [after] = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, d.id));
    expect(after?.status).toBe('failed');
  });

  it('canonicalBody is stable JSON for signing', () => {
    expect(canonicalBody('page.created', { id: 'p1' })).toBe(
      JSON.stringify({ event: 'page.created', data: { id: 'p1' } }),
    );
  });

  // v0.9.0 G7 P36 — kind='slack' webhooks send a translated Slack message
  // shape rather than the canonical {event, data} envelope. The HMAC still
  // signs the EXACT bytes we POST (so the Cairn signature header stays
  // honest), and the posted-message log row is written on 2xx.
  it('dispatches kind=slack webhooks with a Slack payload shape + writes posted-log', async () => {
    const u = await createTestWorkspaceWithUser(db);
    // Seed a page so the posted-log FK is satisfied.
    const pageId = '99999999-9999-9999-9999-999999999999';
    await sql`INSERT INTO pages (id, workspace_id, title, content, created_by, created_at, updated_at)
              VALUES (${pageId}::uuid, ${u.workspaceId}::uuid, 'Hello',
                      '{}'::jsonb, ${u.userId}::uuid, now(), now())
              ON CONFLICT DO NOTHING`;

    const [hook] = await db
      .insert(schema.webhooks)
      .values({
        workspaceId: u.workspaceId,
        url: 'https://hooks.slack.com/services/x/y/z',
        events: ['page.created'],
        secret: 'whsec_slack',
        active: true,
        kind: 'slack',
        platformMetadata: { team_id: 'T1', channel_id: 'C1' },
      })
      .returning();
    if (!hook) throw new Error('slack hook insert failed');

    const [d] = await db
      .insert(schema.webhookDeliveries)
      .values({
        webhookId: hook.id,
        event: 'page.created',
        payload: { page: { id: pageId, title: 'Hello' }, actor: { name: 'Alice' } } as never,
        status: 'pending',
      })
      .returning();
    if (!d) throw new Error('delivery insert failed');

    const seen: { body: string } = { body: '' };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      seen.body = init.body as string;
      return new Response(JSON.stringify({ ok: true, ts: '1700000000.000100', channel: 'C1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await deliver(d.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(seen.body) as { text?: string; blocks?: unknown };
    expect(parsed.blocks).toBeDefined();
    expect(parsed.text).toMatch(/Alice/);

    const logRows = await db.select().from(schema.chatPostedMessages);
    expect(logRows).toHaveLength(1);
    expect(logRows[0]?.platform).toBe('slack');
    expect(logRows[0]?.channelId).toBe('C1');
    expect(logRows[0]?.threadTs).toBe('1700000000.000100');
    expect(logRows[0]?.pageId).toBe(pageId);
  });
});
