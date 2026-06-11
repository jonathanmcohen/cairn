import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { logger } from '@/lib/observability/logger';
import type { SearchResult } from '@/lib/pages/search';
import { signEnvelope } from './peer-hmac';
import {
  isEncryptedSecret,
  PEER_SECRET_ENV_VAR,
  PeerSecretDecryptError,
  resolvePeerSecret,
  shouldWarnRawSecretsAtRest,
} from './peer-secret';

/**
 * v0.9.0 G5 P30 — peer fan-out for cross-instance federated search.
 *
 * Lists every `enabled` peer for the calling workspace, signs an envelope per
 * peer with that peer's shared secret, fetches in parallel (5s timeout +
 * per-peer rate limit 10/min in a single Cairn process), and merges the
 * responses with `(peerName, pageId)` dedup.
 *
 * Errors are recorded in `peer_instances.last_error` but do NOT abort the
 * fan-out for healthy peers. Successful calls clear `last_error` and stamp
 * `last_synced_at`.
 *
 * Rate-limit is in-process — adequate for the homelab single-container
 * deployment but would need a shared store (Redis) before multi-process
 * scale-out. The bucket key is the peer row id, so two workspaces pointing
 * at the same baseUrl with different peer rows share NO limiter state.
 */

const RATE_LIMIT = 10; // calls per peer per window
const RATE_WINDOW_MS = 60_000;

type RateBucket = { count: number; windowStart: number };
const buckets = new Map<string, RateBucket>(); // peerId → bucket

/** Test-only: clear rate-limit state between tests. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
}

function allow(peerId: string): boolean {
  const now = Date.now();
  const b = buckets.get(peerId);
  if (!b || now - b.windowStart > RATE_WINDOW_MS) {
    buckets.set(peerId, { count: 1, windowStart: now });
    return true;
  }
  if (b.count >= RATE_LIMIT) return false;
  b.count += 1;
  return true;
}

export type PeerHit = SearchResult & { peerName: string; workspaceId: string };

export type FanOutInput = {
  workspaceId: string;
  query: string;
  /**
   * Federation opt-in gate: when empty, the fan-out is skipped entirely
   * (fresh installs). In the MVP the same secret is stored per row in
   * `peer_instances.shared_secret_hash` (see schema comment), and since
   * v0.10.0 G1 each request is signed with THAT row's secret, resolved via
   * `resolvePeerSecret` (decrypted when the row is enc-v1) — so per-peer
   * secrets now work, with this env value as the legacy mirror.
   */
  sharedSecret: string;
  /** Test seam — production passes the global `fetch`. */
  fetchImpl?: typeof fetch;
};

export async function fanOutToPeers(
  db: PostgresJsDatabase<typeof schema>,
  input: FanOutInput,
): Promise<PeerHit[]> {
  if (!input.sharedSecret) return [];
  const fetchImpl = input.fetchImpl ?? fetch;
  const envKey = process.env.CAIRN_PEER_SECRET_KEY;
  const peers = await db
    .select()
    .from(schema.peerInstances)
    .where(eq(schema.peerInstances.workspaceId, input.workspaceId));
  const enabled = peers.filter((p) => p.enabled);

  // v0.10.0 G1 — keyless deployments with raw rows keep working, but warn the
  // operator once per process that the secrets are raw at rest.
  if (!envKey && enabled.some((p) => !isEncryptedSecret(p.sharedSecretHash))) {
    if (shouldWarnRawSecretsAtRest()) {
      logger.warn(
        `peer_instances stores raw shared secrets at rest; set ${PEER_SECRET_ENV_VAR} to enable encryption at rest for federated peer secrets`,
      );
    }
  }

  const callOne = async (peer: (typeof enabled)[number]): Promise<PeerHit[]> => {
    if (!allow(peer.id)) return [];
    // v0.10.0 G1 — resolve the per-peer stored secret (enc-v1 rows decrypt
    // under CAIRN_PEER_SECRET_KEY; raw rows pass through — in the MVP they
    // mirror `input.sharedSecret`, see FanOutInput). A row that fails to
    // decrypt (rotated/lost key) is SKIPPED — fail closed for that peer, never
    // crash the whole fan-out. No lazy re-encryption here: the inbound verify
    // path owns the upgrade, since only it can prove the secret is right.
    let signingSecret: string;
    try {
      signingSecret = (await resolvePeerSecret(peer.sharedSecretHash, envKey)).secret;
    } catch (err) {
      if (err instanceof PeerSecretDecryptError) {
        logger.error({ peerName: peer.name }, err.message);
        return [];
      }
      throw err;
    }
    const ts = Date.now();
    const nonce = randomUUID();
    const signed = signEnvelope(
      { q: input.query, workspaceScope: 'all', ts, nonce },
      signingSecret,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetchImpl(`${peer.baseUrl.replace(/\/$/, '')}/api/search/federated/peer`, {
        method: 'POST',
        headers: signed.headers,
        body: signed.body,
        signal: controller.signal,
      });
      if (!res.ok) {
        await db
          .update(schema.peerInstances)
          .set({ lastError: `HTTP ${res.status}` })
          .where(eq(schema.peerInstances.id, peer.id));
        return [];
      }
      const json = (await res.json()) as { results?: SearchResult[] };
      const seen = new Set<string>();
      const out: PeerHit[] = [];
      for (const r of json.results ?? []) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push({ ...r, peerName: peer.name, workspaceId: input.workspaceId });
      }
      await db
        .update(schema.peerInstances)
        .set({ lastSyncedAt: new Date(), lastError: null })
        .where(eq(schema.peerInstances.id, peer.id));
      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'fan-out error';
      await db
        .update(schema.peerInstances)
        .set({ lastError: message })
        .where(eq(schema.peerInstances.id, peer.id));
      return [];
    } finally {
      clearTimeout(timeout);
    }
  };

  const all = await Promise.all(enabled.map(callOne));
  return all.flat();
}
