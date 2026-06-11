import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { __resetRateLimitForTests, fanOutToPeers } from '@/lib/search/peer-fanout';
import { encryptPeerSecret } from '@/lib/search/peer-secret';
import { startPostgres, stopPostgres } from '../../helpers/db';
import { createTestWorkspaceWithUser } from '../../helpers/fixtures';

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

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, peer_instances RESTART IDENTITY CASCADE`;
  __resetRateLimitForTests();
  delete process.env.CAIRN_PEER_SECRET_KEY;
});

afterEach(() => {
  delete process.env.CAIRN_PEER_SECRET_KEY;
});

const sharedSecret = 'shared-secret-aaaaaaaaaaaaaaaaaaaaaaaa';

async function seedPeer(input: {
  workspaceId: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
}): Promise<schema.PeerInstance> {
  const [row] = await db
    .insert(schema.peerInstances)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      baseUrl: input.baseUrl,
      sharedSecretHash: sharedSecret, // MVP — raw secret; see schema docs.
      enabled: input.enabled,
    })
    .returning();
  if (!row) throw new Error('failed to insert peer');
  return row;
}

describe('fanOutToPeers', () => {
  it('fans out + merges across two enabled peers', async () => {
    const w = await createTestWorkspaceWithUser(db);
    await seedPeer({
      workspaceId: w.workspaceId,
      name: 'p1',
      baseUrl: 'http://p1.test',
      enabled: true,
    });
    await seedPeer({
      workspaceId: w.workspaceId,
      name: 'p2',
      baseUrl: 'http://p2.test',
      enabled: true,
    });
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      const body = u.startsWith('http://p1.test')
        ? { results: [{ id: 'page-a', title: 'A', snippet: null, rank: 1, breadcrumb: [] }] }
        : { results: [{ id: 'page-b', title: 'B', snippet: null, rank: 1, breadcrumb: [] }] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const r = await fanOutToPeers(db, {
      workspaceId: w.workspaceId,
      query: 'x',
      sharedSecret,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(r.map((x) => `${x.peerName}/${x.id}`).sort()).toEqual(['p1/page-a', 'p2/page-b']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('skips peers where enabled = false', async () => {
    const w = await createTestWorkspaceWithUser(db);
    await seedPeer({
      workspaceId: w.workspaceId,
      name: 'on',
      baseUrl: 'http://on.test',
      enabled: true,
    });
    await seedPeer({
      workspaceId: w.workspaceId,
      name: 'off',
      baseUrl: 'http://off.test',
      enabled: false,
    });
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    await fanOutToPeers(db, {
      workspaceId: w.workspaceId,
      query: 'x',
      sharedSecret,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('dedupes (peerName, pageId) collisions within a single peer response', async () => {
    const w = await createTestWorkspaceWithUser(db);
    await seedPeer({
      workspaceId: w.workspaceId,
      name: 'p1',
      baseUrl: 'http://p1.test',
      enabled: true,
    });
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              { id: 'page-a', title: 'A', snippet: null, rank: 1, breadcrumb: [] },
              { id: 'page-a', title: 'A duplicate', snippet: null, rank: 1, breadcrumb: [] },
            ],
          }),
          { status: 200 },
        ),
    );
    const r = await fanOutToPeers(db, {
      workspaceId: w.workspaceId,
      query: 'x',
      sharedSecret,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(r).toHaveLength(1);
    expect(r[0]?.id).toBe('page-a');
  });

  it('enforces 10/min per-peer rate limit', async () => {
    const w = await createTestWorkspaceWithUser(db);
    await seedPeer({
      workspaceId: w.workspaceId,
      name: 'p1',
      baseUrl: 'http://p1.test',
      enabled: true,
    });
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    for (let i = 0; i < 10; i++) {
      await fanOutToPeers(db, {
        workspaceId: w.workspaceId,
        query: `x${i}`,
        sharedSecret,
        fetchImpl: fetchSpy as unknown as typeof fetch,
      });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(10);
    // 11th call should not fire fetch for that peer.
    await fanOutToPeers(db, {
      workspaceId: w.workspaceId,
      query: 'x10',
      sharedSecret,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(10);
  });

  // v0.10.0 G1 — outbound resolution of encrypted-at-rest secrets.
  it('signs with the decrypted row secret when the row is enc-v1 and the env key is set', async () => {
    const envKey = 'fanout-test-peer-key-0123456789a';
    process.env.CAIRN_PEER_SECRET_KEY = envKey;
    const w = await createTestWorkspaceWithUser(db);
    await db.insert(schema.peerInstances).values({
      workspaceId: w.workspaceId,
      name: 'enc',
      baseUrl: 'http://enc.test',
      sharedSecretHash: await encryptPeerSecret(sharedSecret, envKey),
      secretFormat: 'enc-v1',
      enabled: true,
    });
    const fetchSpy = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [{ id: 'page-e', title: 'E', snippet: null, rank: 1, breadcrumb: [] }],
          }),
          { status: 200 },
        ),
    );
    const r = await fanOutToPeers(db, {
      workspaceId: w.workspaceId,
      query: 'x',
      sharedSecret,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.map((x) => x.id)).toEqual(['page-e']);
    // The signed request never carries the secret itself — only the HMAC.
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(JSON.stringify(init?.headers ?? {})).not.toContain(sharedSecret);
  });

  it('SKIPS a peer whose enc-v1 secret cannot be decrypted (rotated key) without crashing the fan-out', async () => {
    const envKey = 'fanout-test-peer-key-0123456789a';
    const w = await createTestWorkspaceWithUser(db);
    // Row encrypted under a DIFFERENT key than the current env key.
    await db.insert(schema.peerInstances).values({
      workspaceId: w.workspaceId,
      name: 'rotated',
      baseUrl: 'http://rotated.test',
      sharedSecretHash: await encryptPeerSecret(sharedSecret, 'an-old-rotated-key-zzzzzzzzzz'),
      secretFormat: 'enc-v1',
      enabled: true,
    });
    // A healthy raw peer alongside it keeps working.
    await seedPeer({
      workspaceId: w.workspaceId,
      name: 'healthy',
      baseUrl: 'http://healthy.test',
      enabled: true,
    });
    process.env.CAIRN_PEER_SECRET_KEY = envKey;
    const fetchSpy = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    await fanOutToPeers(db, {
      workspaceId: w.workspaceId,
      query: 'x',
      sharedSecret,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    // Only the healthy peer was called; the undecryptable one was skipped.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0]?.[0];
    expect(String(url)).toContain('healthy.test');
  });

  it('records peer error in last_error column on non-200', async () => {
    const w = await createTestWorkspaceWithUser(db);
    const peer = await seedPeer({
      workspaceId: w.workspaceId,
      name: 'p1',
      baseUrl: 'http://p1.test',
      enabled: true,
    });
    const fetchSpy = vi.fn(async () => new Response('boom', { status: 500 }));
    await fanOutToPeers(db, {
      workspaceId: w.workspaceId,
      query: 'x',
      sharedSecret,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const [row] = await db
      .select()
      .from(schema.peerInstances)
      .where(eq(schema.peerInstances.id, peer.id));
    expect(row?.lastError).toContain('500');
  });
});
