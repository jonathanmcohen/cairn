import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { __resetRateLimitForTests, fanOutToPeers } from '@/lib/search/peer-fanout';
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
