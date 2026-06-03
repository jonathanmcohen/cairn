import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { __resetNonceLruForTests, signEnvelope } from '@/lib/search/peer-hmac';
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
  process.env.AUTH_SECRET = 'x'.repeat(32);
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterAll(async () => {
  await sql.end();
  await stopPostgres();
});

beforeEach(async () => {
  await sql`TRUNCATE pages, workspaces, users, workspace_members, peer_instances RESTART IDENTITY CASCADE`;
  __resetNonceLruForTests();
});

const sharedSecret = 'shared-secret-aaaaaaaaaaaaaaaaaaaaaaaa';

async function seedPeer(workspaceId: string, name: string, enabled = true): Promise<void> {
  await db.insert(schema.peerInstances).values({
    workspaceId,
    name,
    baseUrl: 'http://x',
    sharedSecretHash: sharedSecret,
    enabled,
  });
}

describe('POST /api/search/federated/peer', () => {
  it('returns results when HMAC verifies', async () => {
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await seedPeer(w.workspaceId, 'incoming');
    await createPage(db, {
      workspaceId: w.workspaceId,
      createdBy: w.userId,
      title: 'federation hit',
    });

    const { POST } = await import('@/app/api/search/federated/peer/route');
    const ts = Date.now();
    const signed = signEnvelope(
      { q: 'federation', workspaceScope: 'all', ts, nonce: 'in-n1' },
      sharedSecret,
    );
    const res = await POST(
      new Request('http://x/peer', {
        method: 'POST',
        headers: signed.headers,
        body: signed.body,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ title: string }> };
    expect(body.results.map((r) => r.title)).toContain('federation hit');
  });

  it('rejects tampered request with 401', async () => {
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await seedPeer(w.workspaceId, 'incoming');

    const { POST } = await import('@/app/api/search/federated/peer/route');
    const ts = Date.now();
    const signed = signEnvelope(
      { q: 'x', workspaceScope: 'all', ts, nonce: 'in-n2' },
      sharedSecret,
    );
    // Replace the sig with an obvious wrong one but keep the body parseable
    // so we exercise the bad_signature branch (not the malformed branch).
    const badHeaders = { ...signed.headers, 'x-cairn-peer-sig': 'a'.repeat(64) };
    const res = await POST(
      new Request('http://x/peer', { method: 'POST', headers: badHeaders, body: signed.body }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects when no peer is registered (unknown_peer 401)', async () => {
    const { POST } = await import('@/app/api/search/federated/peer/route');
    const ts = Date.now();
    const signed = signEnvelope(
      { q: 'x', workspaceScope: 'all', ts, nonce: 'in-n3' },
      sharedSecret,
    );
    const res = await POST(
      new Request('http://x/peer', {
        method: 'POST',
        headers: signed.headers,
        body: signed.body,
      }),
    );
    expect(res.status).toBe(401);
  });
});
