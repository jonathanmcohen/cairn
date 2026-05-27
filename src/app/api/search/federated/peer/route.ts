import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { searchPages } from '@/lib/pages/search';
import { verifyEnvelopeWithBody } from '@/lib/search/peer-hmac';

/**
 * v0.9.0 G5 P30 — INBOUND federated-search endpoint.
 *
 * Peer-authenticated (NOT user-authenticated). The HMAC-signed envelope
 * `signEnvelope` produces on the outbound side is verified against every
 * enabled row in `peer_instances`. Whichever peer's secret matches identifies
 * the caller — the matched row's `workspace_id` is the scope for the local
 * search.
 *
 * MVP CAVEATS:
 *   - `peer_instances.shared_secret_hash` currently stores the RAW secret.
 *     The column name promises hashing (argon2id/bcrypt); a v1.0 hardening
 *     plan should switch to keyed hashing so a DB dump alone is insufficient
 *     to forge inbound requests. Until then, treat the table like any other
 *     secret store and gate DB read access with the same care as
 *     personal_access_tokens.token_hash.
 *   - The receiving side does NOT enforce per-peer rate limits or
 *     `enable_federated_search` at the workspace level beyond peer-list
 *     membership. Add both before opening the federation surface to public
 *     mesh deployments.
 *   - Encrypted pages (`pages.encrypted = true`) are filtered defense-in-depth
 *     even though `searchPages` already excludes them. Federation must NEVER
 *     leak ciphertext.
 */
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const db = getDb();

  // Pull every enabled peer row. In a typical deployment N ≤ 10 per
  // workspace, so the HMAC sweep is O(N) hashes per request — cheap.
  const peers = await db.select().from(schema.peerInstances);
  const peerList = peers
    .filter((p) => p.enabled)
    .map((p) => ({
      name: p.name,
      secret: p.sharedSecretHash, // MVP: raw secret — see file header.
      workspaceId: p.workspaceId,
    }));

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
