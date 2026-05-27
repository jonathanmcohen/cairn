import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import type { SearchResult } from '@/lib/pages/search';
import { signEnvelope } from './peer-hmac';

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
   * Outbound secret used to sign every request. In the MVP the same secret
   * is stored in `peer_instances.shared_secret_hash` (see schema comment) so
   * the receiving instance can recompute the signature; a v1.0 hardening
   * plan should switch to per-peer derived secrets.
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
  const peers = await db
    .select()
    .from(schema.peerInstances)
    .where(eq(schema.peerInstances.workspaceId, input.workspaceId));
  const enabled = peers.filter((p) => p.enabled);

  const callOne = async (peer: (typeof enabled)[number]): Promise<PeerHit[]> => {
    if (!allow(peer.id)) return [];
    const ts = Date.now();
    const nonce = randomUUID();
    const signed = signEnvelope(
      { q: input.query, workspaceScope: 'all', ts, nonce },
      input.sharedSecret,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetchImpl(
        `${peer.baseUrl.replace(/\/$/, '')}/api/search/federated/peer`,
        {
          method: 'POST',
          headers: signed.headers,
          body: signed.body,
          signal: controller.signal,
        },
      );
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
