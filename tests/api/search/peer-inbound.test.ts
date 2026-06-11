import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { createPage } from '@/lib/pages/create';
import { __resetNonceLruForTests, signEnvelope } from '@/lib/search/peer-hmac';
import {
  __resetPeerRateLimiterForTests,
  __setPeerRateLimiterForTests,
  PEER_RATE_LIMIT_ENV_VAR,
} from '@/lib/search/peer-rate-limit';
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
  __resetPeerRateLimiterForTests();
  delete process.env.CAIRN_PEER_SECRET_KEY;
  delete process.env[PEER_RATE_LIMIT_ENV_VAR];
});

afterEach(() => {
  delete process.env.CAIRN_PEER_SECRET_KEY;
  delete process.env[PEER_RATE_LIMIT_ENV_VAR];
  __resetPeerRateLimiterForTests();
});

const sharedSecret = 'shared-secret-aaaaaaaaaaaaaaaaaaaaaaaa';

async function seedPeer(
  workspaceId: string,
  name: string,
  enabled = true,
  secret = sharedSecret,
): Promise<void> {
  await db.insert(schema.peerInstances).values({
    workspaceId,
    name,
    baseUrl: 'http://x',
    sharedSecretHash: secret,
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

// v0.10.0 G2 — per-peer inbound rate limit (peer-rate-limit.ts).
describe('POST /api/search/federated/peer — per-peer rate limit (G2)', () => {
  async function postSignedAs(secret: string, nonce: string, q = 'x'): Promise<Response> {
    const { POST } = await import('@/app/api/search/federated/peer/route');
    const signed = signEnvelope({ q, workspaceScope: 'all', ts: Date.now(), nonce }, secret);
    return POST(
      new Request('http://x/peer', { method: 'POST', headers: signed.headers, body: signed.body }),
    );
  }

  it('allows N requests then 429s the N+1th with Retry-After ≥ 1 and writes the audit row', async () => {
    process.env[PEER_RATE_LIMIT_ENV_VAR] = '3';
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await seedPeer(w.workspaceId, 'limited');

    for (let i = 0; i < 3; i++) {
      expect((await postSignedAs(sharedSecret, `g2-ok-${i}`)).status).toBe(200);
    }
    const res = await postSignedAs(sharedSecret, 'g2-over');
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get('retry-after'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toEqual({ error: 'rate limited' });

    const rows = await sql`
      select workspace_id, actor_user_id, target_type, target_id, metadata
        from audit_log where action = 'federation.peer_rate_limited'
    `;
    expect(rows).toHaveLength(1);
    const audit = rows[0] as {
      workspace_id: string;
      actor_user_id: string | null;
      target_type: string;
      metadata: { peerName?: string; retryAfterMs?: number };
    };
    expect(audit.workspace_id).toBe(w.workspaceId);
    expect(audit.actor_user_id).toBeNull();
    expect(audit.target_type).toBe('peer_instance');
    expect(audit.metadata.peerName).toBe('limited');
    expect(audit.metadata.retryAfterMs).toBeGreaterThan(0);
    // Never the shared secret — in any key or value.
    expect(JSON.stringify(audit.metadata)).not.toContain(sharedSecret);
  });

  it('keys by peer id — a second peer is unaffected by the first one’s exhaustion', async () => {
    process.env[PEER_RATE_LIMIT_ENV_VAR] = '2';
    const otherSecret = 'other-secret-bbbbbbbbbbbbbbbbbbbbbbbb';
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await seedPeer(w.workspaceId, 'peer-a');
    await seedPeer(w.workspaceId, 'peer-b', true, otherSecret);

    expect((await postSignedAs(sharedSecret, 'g2-iso-1')).status).toBe(200);
    expect((await postSignedAs(sharedSecret, 'g2-iso-2')).status).toBe(200);
    expect((await postSignedAs(sharedSecret, 'g2-iso-3')).status).toBe(429);
    // peer-b's bucket is untouched.
    expect((await postSignedAs(otherSecret, 'g2-iso-4')).status).toBe(200);
  });

  it('verify-before-limit: garbage signatures do not burn the peer’s budget', async () => {
    process.env[PEER_RATE_LIMIT_ENV_VAR] = '2';
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await seedPeer(w.workspaceId, 'unburned');

    const { POST } = await import('@/app/api/search/federated/peer/route');
    for (let i = 0; i < 5; i++) {
      const signed = signEnvelope(
        { q: 'x', workspaceScope: 'all', ts: Date.now(), nonce: `g2-junk-${i}` },
        sharedSecret,
      );
      const badHeaders = { ...signed.headers, 'x-cairn-peer-sig': 'a'.repeat(64) };
      const res = await POST(
        new Request('http://x/peer', { method: 'POST', headers: badHeaders, body: signed.body }),
      );
      expect(res.status).toBe(401);
    }
    // The full budget is still available to the legitimate peer.
    expect((await postSignedAs(sharedSecret, 'g2-burn-1')).status).toBe(200);
    expect((await postSignedAs(sharedSecret, 'g2-burn-2')).status).toBe(200);
    expect((await postSignedAs(sharedSecret, 'g2-burn-3')).status).toBe(429);
  });

  it('limiter failure FAILS CLOSED: 503, never an open relay', async () => {
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await seedPeer(w.workspaceId, 'broken-limiter');
    __setPeerRateLimiterForTests({
      check: () => {
        throw new Error('boom');
      },
    });

    const res = await postSignedAs(sharedSecret, 'g2-closed-1');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'rate limiter unavailable' });
  });

  it('a throttled request does NOT trigger the lazy G1 secret upgrade (no writes on 429)', async () => {
    process.env.CAIRN_PEER_SECRET_KEY = 'g2-rate-limit-upgrade-key-012345';
    const w = await createTestWorkspaceWithUser(db, { defaultPageStatus: 'published' });
    await seedPeer(w.workspaceId, 'throttled-raw');
    // Deny everything: the request verifies but is throttled before upgrade.
    __setPeerRateLimiterForTests({
      check: () => ({ allowed: false, remaining: 0, retryAfterMs: 1500 }),
    });

    const res = await postSignedAs(sharedSecret, 'g2-noup-1');
    expect(res.status).toBe(429);

    const rows = await sql`
      select shared_secret_hash, secret_format from peer_instances where name = 'throttled-raw'
    `;
    const row = rows[0] as { shared_secret_hash: string; secret_format: string };
    expect(row.secret_format).toBe('raw');
    expect(row.shared_secret_hash).toBe(sharedSecret);
  });
});
