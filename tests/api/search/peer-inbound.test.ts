import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { __resetNonceLruForTests, signEnvelope } from '@/lib/search/peer-hmac';
import {
  __resetPeerSecretCacheForTests,
  decryptPeerSecret,
  encryptPeerSecret,
  isEncryptedSecret,
} from '@/lib/search/peer-secret';
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
  __resetPeerSecretCacheForTests();
  delete process.env.CAIRN_PEER_SECRET_KEY;
});

afterEach(() => {
  delete process.env.CAIRN_PEER_SECRET_KEY;
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

// v0.10.0 G1 — at-rest encryption of peer secrets (peer-secret.ts).
describe('POST /api/search/federated/peer — secret encryption at rest (G1)', () => {
  const envKey = 'inbound-test-peer-key-0123456789';

  async function loadRow(name: string) {
    const rows = await sql`
      select shared_secret_hash, secret_format from peer_instances where name = ${name}
    `;
    return rows[0] as { shared_secret_hash: string; secret_format: string };
  }

  async function postSigned(nonce: string, q = 'x'): Promise<Response> {
    const { POST } = await import('@/app/api/search/federated/peer/route');
    const signed = signEnvelope({ q, workspaceScope: 'all', ts: Date.now(), nonce }, sharedSecret);
    return POST(
      new Request('http://x/peer', { method: 'POST', headers: signed.headers, body: signed.body }),
    );
  }

  it('raw row + env key set: verifies AND lazily upgrades the row to enc-v1', async () => {
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await seedPeer(w.workspaceId, 'upgrader');
    process.env.CAIRN_PEER_SECRET_KEY = envKey;

    const res = await postSigned('g1-up-1');
    expect(res.status).toBe(200);

    const row = await loadRow('upgrader');
    expect(row.secret_format).toBe('enc-v1');
    expect(isEncryptedSecret(row.shared_secret_hash)).toBe(true);
    expect(row.shared_secret_hash).not.toContain(sharedSecret);
    // The envelope decrypts back to the original secret, so the NEXT request
    // still verifies (round-trip through the route).
    await expect(decryptPeerSecret(row.shared_secret_hash, envKey)).resolves.toBe(sharedSecret);
    expect((await postSigned('g1-up-2')).status).toBe(200);
  });

  it('raw row stays raw on a FAILED verify even with the env key set (no upgrade for attackers)', async () => {
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await seedPeer(w.workspaceId, 'no-upgrade');
    process.env.CAIRN_PEER_SECRET_KEY = envKey;

    const { POST } = await import('@/app/api/search/federated/peer/route');
    const signed = signEnvelope(
      { q: 'x', workspaceScope: 'all', ts: Date.now(), nonce: 'g1-bad-1' },
      sharedSecret,
    );
    const badHeaders = { ...signed.headers, 'x-cairn-peer-sig': 'a'.repeat(64) };
    const res = await POST(
      new Request('http://x/peer', { method: 'POST', headers: badHeaders, body: signed.body }),
    );
    expect(res.status).toBe(401);

    const row = await loadRow('no-upgrade');
    expect(row.secret_format).toBe('raw');
    expect(row.shared_secret_hash).toBe(sharedSecret);
  });

  it('enc-v1 row + correct env key: request verifies through decryption', async () => {
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await db.insert(schema.peerInstances).values({
      workspaceId: w.workspaceId,
      name: 'encrypted-peer',
      baseUrl: 'http://x',
      sharedSecretHash: await encryptPeerSecret(sharedSecret, envKey),
      secretFormat: 'enc-v1',
      enabled: true,
    });
    process.env.CAIRN_PEER_SECRET_KEY = envKey;

    expect((await postSigned('g1-enc-1')).status).toBe(200);
  });

  it('enc-v1 row + WRONG env key: request is rejected (fail closed), row unchanged', async () => {
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const stored = await encryptPeerSecret(sharedSecret, envKey);
    await db.insert(schema.peerInstances).values({
      workspaceId: w.workspaceId,
      name: 'rotated-away',
      baseUrl: 'http://x',
      sharedSecretHash: stored,
      secretFormat: 'enc-v1',
      enabled: true,
    });
    process.env.CAIRN_PEER_SECRET_KEY = 'a-rotated-wrong-key-9876543210';

    const res = await postSigned('g1-wrong-1');
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toContain(sharedSecret);
    expect(body).not.toContain('enc-v1:');

    const row = await loadRow('rotated-away');
    expect(row.shared_secret_hash).toBe(stored);
    expect(row.secret_format).toBe('enc-v1');
  });

  it('enc-v1 row + NO env key: request is rejected (fail closed), row unchanged', async () => {
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    const stored = await encryptPeerSecret(sharedSecret, envKey);
    await db.insert(schema.peerInstances).values({
      workspaceId: w.workspaceId,
      name: 'keyless-encrypted',
      baseUrl: 'http://x',
      sharedSecretHash: stored,
      secretFormat: 'enc-v1',
      enabled: true,
    });

    expect((await postSigned('g1-nokey-1')).status).toBe(401);
    const row = await loadRow('keyless-encrypted');
    expect(row.shared_secret_hash).toBe(stored);
  });

  it('keyless + raw row: legacy verify still works and the row is NEVER upgraded', async () => {
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await seedPeer(w.workspaceId, 'legacy');

    expect((await postSigned('g1-legacy-1')).status).toBe(200);
    const row = await loadRow('legacy');
    expect(row.secret_format).toBe('raw');
    expect(row.shared_secret_hash).toBe(sharedSecret);
  });
});
