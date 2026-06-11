// v0.10.0 G2 — per-peer inbound rate limit on the federated-search route.
//
// What this spec pins against the LIVE server (through the proxy — the
// inbound peer route is cookieless and lives in PUBLIC_PATHS):
//   1. falsifiable core: an authenticated peer that bursts past the default
//      ceiling (CAIRN_PEER_RATE_LIMIT_PER_MIN, 60/min) gets a 429 with a
//      parseable positive-integer Retry-After header, every response before
//      it was 200, and a 'federation.peer_rate_limited' audit row exists;
//   2. key isolation: exhausting peer A leaves peer B's budget untouched
//      (the limit is keyed by peer row id, not IP — through one egress);
//   3. verify-before-limit: 70 garbage-signature requests do NOT burn the
//      peer's budget — one valid request afterwards still gets 200.
//
// Limiter state is in-process on the server and survives between TESTS in a
// run (reuseExistingServer), so every test seeds its OWN stamped peer row —
// fresh row id ⇒ fresh bucket. The dev DB is persistent across specs: every
// seeded peer AND its audit rows are removed in finally, and nonces are
// unique per request (the server's replay LRU survives between tests).
import { createHmac, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { expect, test } from '../a11y/fixtures';

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

async function seedRawPeer(workspaceId: string, name: string, secret: string): Promise<string> {
  return withSql(async (sql) => {
    const rows = await sql`
      INSERT INTO peer_instances (workspace_id, name, base_url, shared_secret_hash, secret_format, enabled)
      VALUES (${workspaceId}::uuid, ${name}, 'http://g2-e2e.invalid', ${secret}, 'raw', true)
      RETURNING id
    `;
    return (rows[0] as { id: string }).id;
  });
}

/** Remove the seeded peer AND every audit row the rate limiter wrote for it. */
async function cleanupPeer(id: string): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      DELETE FROM audit_log
       WHERE action = 'federation.peer_rate_limited' AND target_id = ${id}::uuid
    `;
    await sql`DELETE FROM peer_instances WHERE id = ${id}::uuid`;
  });
}

// Default ceiling is 60/min; the bucket refills ~1 token/s while we loop, so
// 70 attempts is comfortably past it for a fast local burst.
const MAX_ATTEMPTS = 70;

test.describe('item G2 — per-peer inbound rate limit', () => {
  test('falsifiable core: burst past the ceiling → 429 + Retry-After + audit row, all prior responses 200', async ({
    page,
    seeded,
  }) => {
    const stamp = Date.now().toString(36);
    const peerName = `g2-burst-${stamp}`;
    const secret = `g2-e2e-secret-burst-${randomUUID()}`;
    const peerId = await seedRawPeer(seeded.workspaceId, peerName, secret);
    try {
      const statuses: number[] = [];
      let limited: { status: number; retryAfter: string | null } | null = null;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const envelope = signedEnvelope({
          q: 'g2 burst probe',
          workspaceScope: 'all',
          ts: Date.now(),
          nonce: `g2-burst-${stamp}-${i}-${randomUUID()}`, // fresh nonce — replay guard
          secret,
        });
        const res = await page.request.post('/api/search/federated/peer', {
          headers: envelope.headers,
          data: envelope.body,
        });
        if (res.status() === 429) {
          limited = { status: res.status(), retryAfter: res.headers()['retry-after'] ?? null };
          break;
        }
        statuses.push(res.status());
      }

      // A 429 MUST appear within the attempt budget…
      expect(limited, `no 429 within ${MAX_ATTEMPTS} signed requests`).not.toBeNull();
      // …every response before it was a successful 200…
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses.every((s) => s === 200)).toBe(true);
      // …and Retry-After parses as a positive integer (whole seconds).
      const retryAfter = Number(limited?.retryAfter);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);

      // The 429 wrote the audit row for THIS peer, with clean metadata.
      const auditRows = await withSql(async (sql) => {
        return sql`
          SELECT metadata FROM audit_log
           WHERE action = 'federation.peer_rate_limited' AND target_id = ${peerId}::uuid
        `;
      });
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      const metadata = (auditRows[0] as { metadata: { peerName?: string } }).metadata;
      expect(metadata.peerName).toBe(peerName);
      expect(JSON.stringify(metadata)).not.toContain(secret);
    } finally {
      await cleanupPeer(peerId);
    }
  });

  test('key isolation: exhausting peer A leaves peer B at 200', async ({ page, seeded }) => {
    const stamp = Date.now().toString(36);
    const secretA = `g2-e2e-secret-a-${randomUUID()}`;
    const secretB = `g2-e2e-secret-b-${randomUUID()}`;
    const peerA = await seedRawPeer(seeded.workspaceId, `g2-iso-a-${stamp}`, secretA);
    const peerB = await seedRawPeer(seeded.workspaceId, `g2-iso-b-${stamp}`, secretB);
    try {
      let sawLimit = false;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const envelope = signedEnvelope({
          q: 'g2 isolation probe',
          workspaceScope: 'all',
          ts: Date.now(),
          nonce: `g2-iso-a-${stamp}-${i}-${randomUUID()}`,
          secret: secretA,
        });
        const res = await page.request.post('/api/search/federated/peer', {
          headers: envelope.headers,
          data: envelope.body,
        });
        if (res.status() === 429) {
          sawLimit = true;
          break;
        }
        expect(res.status()).toBe(200);
      }
      expect(sawLimit, `peer A never hit 429 within ${MAX_ATTEMPTS} requests`).toBe(true);

      // Peer B's bucket is untouched by A's exhaustion.
      const envelopeB = signedEnvelope({
        q: 'g2 isolation probe',
        workspaceScope: 'all',
        ts: Date.now(),
        nonce: `g2-iso-b-${stamp}-${randomUUID()}`,
        secret: secretB,
      });
      const resB = await page.request.post('/api/search/federated/peer', {
        headers: envelopeB.headers,
        data: envelopeB.body,
      });
      expect(resB.status(), await resB.text().catch(() => '')).toBe(200);
    } finally {
      await cleanupPeer(peerA);
      await cleanupPeer(peerB);
    }
  });

  test('verify-before-limit: 70 garbage signatures do not burn the budget — a valid request still gets 200', async ({
    page,
    seeded,
  }) => {
    const stamp = Date.now().toString(36);
    const secret = `g2-e2e-secret-junk-${randomUUID()}`;
    const peerId = await seedRawPeer(seeded.workspaceId, `g2-junk-${stamp}`, secret);
    try {
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const envelope = signedEnvelope({
          q: 'g2 junk probe',
          workspaceScope: 'all',
          ts: Date.now(),
          nonce: `g2-junk-${stamp}-${i}-${randomUUID()}`,
          secret,
        });
        const res = await page.request.post('/api/search/federated/peer', {
          headers: { ...envelope.headers, 'x-cairn-peer-sig': 'a'.repeat(64) },
          data: envelope.body,
        });
        expect(res.status()).toBe(401);
      }

      // One correctly-signed request afterwards: the budget is intact.
      const valid = signedEnvelope({
        q: 'g2 junk probe',
        workspaceScope: 'all',
        ts: Date.now(),
        nonce: `g2-junk-valid-${stamp}-${randomUUID()}`,
        secret,
      });
      const res = await page.request.post('/api/search/federated/peer', {
        headers: valid.headers,
        data: valid.body,
      });
      expect(res.status(), await res.text().catch(() => '')).toBe(200);
    } finally {
      await cleanupPeer(peerId);
    }
  });
});
