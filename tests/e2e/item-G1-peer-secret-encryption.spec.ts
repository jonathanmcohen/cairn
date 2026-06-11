// v0.10.0 G1 — encrypted-at-rest federated peer secrets.
//
// The e2e harness runs WITHOUT CAIRN_PEER_SECRET_KEY (deliberately — the
// keyless/legacy contract is what's testable through the live server; the
// encrypted-path behavior is covered by unit/Testcontainers suites:
// tests/lib/search/peer-secret.test.ts, tests/api/search/peer-inbound.test.ts,
// tests/integration/peer-admin.test.ts, tests/lib/search/peer-fanout.test.ts).
// What this spec pins against the LIVE server (through the proxy — the F1
// lesson; the inbound peer route is cookieless and must be in PUBLIC_PATHS):
//   1. legacy contract: a raw peer row verifies a correctly-signed envelope
//      (HMAC built here with node:crypto, mirroring peer-hmac.ts canonical())
//      and the keyless server NEVER upgrades the row off 'raw';
//   2. a bad signature is still rejected and leaks no secret material;
//   3. migration 0072 is idempotent (re-applying the SQL file is a no-op);
//   4. the admin peers surface never returns shared_secret_hash (the "safe
//      row" contract at peer-admin.ts).
//
// The dev DB is persistent across specs — every seeded row is removed in
// finally, and nonces are unique per run (the server's replay LRU survives
// between tests).
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { expect, signIn, test } from '../a11y/fixtures';

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for the e2e harness');
  const sql = postgres(url, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Build the signed envelope EXACTLY like src/lib/search/peer-hmac.ts:
 * canonical message is `${ts}\n${nonce}\n${workspaceScope}\n${q}` (order is
 * part of the protocol), signature is HMAC-SHA256 hex over it, body is the
 * JSON `{ q, workspaceScope }`.
 */
function signedEnvelope(input: {
  q: string;
  workspaceScope: string;
  ts: number;
  nonce: string;
  secret: string;
}): { headers: Record<string, string>; body: string } {
  const canonical = `${input.ts}\n${input.nonce}\n${input.workspaceScope}\n${input.q}`;
  const sig = createHmac('sha256', input.secret).update(canonical).digest('hex');
  return {
    headers: {
      'content-type': 'application/json',
      'x-cairn-peer-ts': String(input.ts),
      'x-cairn-peer-nonce': input.nonce,
      'x-cairn-peer-sig': sig,
    },
    body: JSON.stringify({ q: input.q, workspaceScope: input.workspaceScope }),
  };
}

const PEER_SECRET = `g1-e2e-shared-secret-${randomUUID()}`;

async function seedRawPeer(workspaceId: string, name: string): Promise<string> {
  return withSql(async (sql) => {
    const rows = await sql`
      INSERT INTO peer_instances (workspace_id, name, base_url, shared_secret_hash, secret_format, enabled)
      VALUES (${workspaceId}::uuid, ${name}, 'http://g1-e2e.invalid', ${PEER_SECRET}, 'raw', true)
      RETURNING id
    `;
    return (rows[0] as { id: string }).id;
  });
}

async function deletePeerRow(id: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`DELETE FROM peer_instances WHERE id = ${id}::uuid`;
  });
}

test.describe('item G1 — peer secret encryption at rest', () => {
  test('legacy contract: a raw row verifies a signed envelope through the live (keyless) server and is never upgraded', async ({
    page,
    seeded,
  }) => {
    const peerName = `g1-legacy-${Date.now().toString(36)}`;
    const peerId = await seedRawPeer(seeded.workspaceId, peerName);
    try {
      const envelope = signedEnvelope({
        q: 'g1 federation probe',
        workspaceScope: 'all',
        ts: Date.now(),
        nonce: `g1-ok-${randomUUID()}`,
        secret: PEER_SECRET,
      });
      // Cookieless on purpose: the inbound peer route is server-to-server and
      // must pass the proxy without a session (PUBLIC_PATHS membership).
      const res = await page.request.post('/api/search/federated/peer', {
        headers: envelope.headers,
        data: envelope.body,
      });
      expect(res.status(), await res.text().catch(() => '')).toBe(200);
      const body = (await res.json()) as { results: unknown[] };
      expect(Array.isArray(body.results)).toBe(true);

      // The keyless server NEVER rewrites the row — raw stays raw.
      const row = await withSql(async (sql) => {
        const rows = await sql`
          SELECT shared_secret_hash, secret_format FROM peer_instances WHERE id = ${peerId}::uuid
        `;
        return rows[0] as { shared_secret_hash: string; secret_format: string };
      });
      expect(row.secret_format).toBe('raw');
      expect(row.shared_secret_hash).toBe(PEER_SECRET);
    } finally {
      await deletePeerRow(peerId);
    }
  });

  test('bad signature is rejected with 401 and the response carries no secret material', async ({
    page,
    seeded,
  }) => {
    const peerName = `g1-badsig-${Date.now().toString(36)}`;
    const peerId = await seedRawPeer(seeded.workspaceId, peerName);
    try {
      const envelope = signedEnvelope({
        q: 'g1 federation probe',
        workspaceScope: 'all',
        ts: Date.now(),
        nonce: `g1-bad-${randomUUID()}`,
        secret: PEER_SECRET,
      });
      const res = await page.request.post('/api/search/federated/peer', {
        headers: { ...envelope.headers, 'x-cairn-peer-sig': 'a'.repeat(64) },
        data: envelope.body,
      });
      expect(res.status()).toBe(401);
      const text = await res.text();
      expect(text).not.toContain(PEER_SECRET);
      expect(text).not.toContain('shared_secret_hash');
    } finally {
      await deletePeerRow(peerId);
    }
  });

  test('migration 0072 is idempotent: re-applying the SQL file twice is a no-op and the schema holds', async () => {
    const file = readFileSync(
      join(process.cwd(), 'drizzle', 'migrations', '0072_peer_secret_format.sql'),
      'utf8',
    );
    await withSql(async (sql) => {
      // The harness DB already ran every migration at boot — applying the
      // file again (twice) IS the idempotence proof.
      await sql.unsafe(file);
      await sql.unsafe(file);

      const cols = await sql`
        SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_name = 'peer_instances' AND column_name = 'secret_format'
      `;
      expect(cols).toHaveLength(1);
      expect((cols[0] as { data_type: string }).data_type).toBe('text');
      expect((cols[0] as { is_nullable: string }).is_nullable).toBe('NO');
      expect((cols[0] as { column_default: string }).column_default).toContain('raw');

      const constraint = await sql`
        SELECT conname FROM pg_constraint WHERE conname = 'peer_instances_secret_format_check'
      `;
      expect(constraint).toHaveLength(1);
    });
  });

  test('admin peers surface never returns shared_secret_hash (safe-row contract)', async ({
    page,
    seeded,
  }) => {
    await signIn(page, seeded);
    const pairedSecret = `g1-e2e-pairing-secret-${randomUUID()}`;
    let createdId: string | null = null;
    try {
      // Pair through the real admin endpoint so the row lives in the SESSION's
      // workspace — the GET below lists that same workspace.
      const created = await page.request.post('/api/admin/federated/peers', {
        data: {
          name: `g1-admin-${Date.now().toString(36)}`,
          baseUrl: 'http://g1-e2e-admin.invalid',
          sharedSecret: pairedSecret,
        },
      });
      expect(created.status(), await created.text().catch(() => '')).toBe(201);
      const createdBody = (await created.json()) as { peer: { id: string; name: string } };
      createdId = createdBody.peer.id;
      // The create response itself must not echo the secret.
      expect(JSON.stringify(createdBody)).not.toContain(pairedSecret);

      const res = await page.request.get('/api/admin/federated/peers');
      expect(res.status()).toBe(200);
      const text = await res.text();
      const body = JSON.parse(text) as { peers: Array<{ id: string }> };
      expect(body.peers.some((p) => p.id === createdId)).toBe(true);
      // The no-leak invariant (peer-admin.ts PeerSummary): no secret value,
      // no secret column, in any casing.
      expect(text).not.toContain(pairedSecret);
      expect(text).not.toContain('shared_secret_hash');
      expect(text).not.toContain('sharedSecretHash');
      expect(text).not.toContain('sharedSecret');
    } finally {
      if (createdId) await deletePeerRow(createdId);
    }
  });
});
