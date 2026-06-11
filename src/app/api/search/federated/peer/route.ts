import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { logger } from '@/lib/observability/logger';
import { searchPages } from '@/lib/pages/search';
import { verifyEnvelopeWithBody } from '@/lib/search/peer-hmac';
import { checkPeerRateLimit } from '@/lib/search/peer-rate-limit';
import {
  encryptPeerSecret,
  isEncryptedSecret,
  PEER_SECRET_ENV_VAR,
  PeerSecretDecryptError,
  resolvePeerSecret,
  shouldWarnRawSecretsAtRest,
} from '@/lib/search/peer-secret';

/**
 * v0.9.0 G5 P30 — INBOUND federated-search endpoint.
 *
 * Peer-authenticated (NOT user-authenticated). The HMAC-signed envelope
 * `signEnvelope` produces on the outbound side is verified against every
 * enabled row in `peer_instances`. Whichever peer's secret matches identifies
 * the caller — the matched row's `workspace_id` is the scope for the local
 * search.
 *
 * v0.10.0 G1 — `shared_secret_hash` is now encrypted at rest when the
 * operator sets CAIRN_PEER_SECRET_KEY (src/lib/search/peer-secret.ts).
 * Resolution rules per row:
 *   - enc-v1 rows decrypt under the env key; a row that fails to decrypt
 *     (rotated/lost key) is EXCLUDED from the candidate list — fail closed
 *     per row, logged once per request with the operator playbook.
 *   - raw rows still verify (legacy / keyless mode). When the env key IS set,
 *     a raw row is lazily re-encrypted after its first SUCCESSFUL verify —
 *     never on an unverified request, so an attacker can't trigger writes.
 *
 * v0.10.0 G2 — per-peer inbound rate limit (peer-rate-limit.ts). Order of
 * operations is load-bearing:
 *   1. verify the envelope (so unauthenticated junk can't burn a peer's
 *      budget — same logic as the replay-after-signature ordering in
 *      peer-hmac.ts);
 *   2. rate-limit the MATCHED peer by row id → 429 + Retry-After + audit row
 *      ('federation.peer_rate_limited'); a broken limiter FAILS CLOSED → 503;
 *   3. only then the lazy secret upgrade (a throttled request must not write)
 *      and the FTS query (the expensive work being protected).
 *
 * REMAINING CAVEATS:
 *   - The receiving side does NOT enforce `enable_federated_search` at the
 *     workspace level beyond peer-list membership. Add it before opening the
 *     federation surface to public mesh deployments.
 *   - Encrypted pages (`pages.encrypted = true`) are filtered defense-in-depth
 *     even though `searchPages` already excludes them. Federation must NEVER
 *     leak ciphertext.
 */
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const db = getDb();
  const envKey = process.env.CAIRN_PEER_SECRET_KEY;

  // Pull every enabled peer row. In a typical deployment N ≤ 10 per
  // workspace, so the HMAC sweep is O(N) hashes per request — cheap. (The
  // Argon2id key derivation for enc-v1 rows is amortised by the derived-key
  // cache in peer-secret.ts.)
  const peers = await db.select().from(schema.peerInstances);
  const enabled = peers.filter((p) => p.enabled);

  const peerList: Array<{
    id: string;
    name: string;
    secret: string;
    workspaceId: string;
    needsUpgrade: boolean;
  }> = [];
  let decryptFailureLogged = false;
  for (const p of enabled) {
    try {
      const resolved = await resolvePeerSecret(p.sharedSecretHash, envKey);
      peerList.push({
        id: p.id,
        name: p.name,
        secret: resolved.secret,
        workspaceId: p.workspaceId,
        needsUpgrade: resolved.needsUpgrade,
      });
    } catch (err) {
      if (err instanceof PeerSecretDecryptError) {
        // Fail closed per row: the peer simply can't authenticate. Log the
        // operator-facing message once per request (it names the env var and
        // the re-pair playbook; it never contains key material/ciphertext).
        if (!decryptFailureLogged) {
          logger.error({ peerName: p.name }, err.message);
          decryptFailureLogged = true;
        }
        continue;
      }
      throw err;
    }
  }

  // Keyless deployments with raw rows keep working, but the operator should
  // know the secrets are raw at rest. Once per process (globalThis flag).
  if (!envKey && enabled.some((p) => !isEncryptedSecret(p.sharedSecretHash))) {
    if (shouldWarnRawSecretsAtRest()) {
      logger.warn(
        `peer_instances stores raw shared secrets at rest; set ${PEER_SECRET_ENV_VAR} to enable encryption at rest for federated peer secrets`,
      );
    }
  }

  const verify = verifyEnvelopeWithBody(req.headers, rawBody, peerList);
  if (!verify.ok) {
    // Generic 400/401 by design — don't reveal which check failed (stale vs
    // bad_sig vs replay) over the wire. Server-side logs carry the kind.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const matched = peerList.find((p) => p.name === verify.peerName);
  if (!matched) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // v0.10.0 G2 — per-peer rate limit, AFTER verify (unauthenticated junk
  // can't burn the peer's budget), BEFORE the lazy upgrade + FTS query (a
  // throttled request neither writes nor does the expensive work). Keyed by
  // peer row id, not IP — peers can share egress. See peer-rate-limit.ts.
  const rate = checkPeerRateLimit(matched.id);
  if (rate.unavailable) {
    // FAIL CLOSED: a broken limiter must not turn federation into an open
    // relay (deliberately stricter than the soft-fail login limiter path).
    return NextResponse.json({ error: 'rate limiter unavailable' }, { status: 503 });
  }
  if (!rate.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    try {
      await recordAudit(db, {
        workspaceId: matched.workspaceId,
        actorUserId: null, // server-to-server: no user behind the request
        action: 'federation.peer_rate_limited',
        targetType: 'peer_instance',
        targetId: matched.id,
        metadata: { peerName: matched.name, retryAfterMs: rate.retryAfterMs },
      });
    } catch (err) {
      // Audit is best-effort here — a failed insert must not mask the 429.
      logger.error(
        { peerName: matched.name },
        `failed to record federation.peer_rate_limited audit row: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
    return NextResponse.json(
      { error: 'rate limited' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  // Lazy at-rest migration: the request VERIFIED under this row's raw secret
  // and the env key is set → re-encrypt the row in place. Failure here must
  // not fail the (already authenticated) search.
  if (matched.needsUpgrade && envKey) {
    try {
      await db
        .update(schema.peerInstances)
        .set({
          sharedSecretHash: await encryptPeerSecret(matched.secret, envKey),
          secretFormat: 'enc-v1',
        })
        .where(eq(schema.peerInstances.id, matched.id));
    } catch (err) {
      logger.error(
        { peerName: matched.name },
        `failed to re-encrypt a verified raw peer secret under ${PEER_SECRET_ENV_VAR}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  // Run local search scoped to the peer's registered workspace. workspaceScope
  // 'all' is accepted today as a wire-compat surface but ignored — the
  // receiver always scopes to the matched peer's workspace_id.
  const results = await searchPages(db, {
    workspaceId: matched.workspaceId,
    query: verify.payload.q,
    limit: 20,
    filters: {},
    mode: 'fts',
  });

  // Defense-in-depth: searchPages already filters `encrypted = false`.
  const filtered = results.filter(
    (r) => !('encrypted' in r) || (r as { encrypted?: boolean }).encrypted !== true,
  );
  return NextResponse.json({ results: filtered });
}
