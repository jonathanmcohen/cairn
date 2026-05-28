import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * v0.9.0 G5 P30 — HMAC-signed envelope for cross-instance federated search.
 *
 * Outbound path: `peer-fanout.ts` calls `signEnvelope` per peer to produce
 * the headers + body. The receiving instance's inbound route
 * (`/api/search/federated/peer`) reads the body, then `verifyEnvelopeWithBody`
 * re-derives the canonical message and compares the HMAC under each known
 * peer's secret. The matching peer's name identifies the caller so the
 * inbound route knows which workspace to scope the search to.
 *
 * Replay protection: each request includes a nonce, and the verifier holds
 * an in-memory LRU of nonces it's seen within the ±300s skew window. A
 * repeated nonce that otherwise verifies returns `kind: 'replay'`. The
 * window is bounded to keep memory finite even under attack. Single-process
 * scope is fine for the homelab target — multi-process deployments would
 * need a shared store (Redis) before this can be considered production-grade.
 *
 * Canonical message: `ts\nnonce\nworkspaceScope\nq`. Concatenation order
 * is load-bearing — do NOT reorder.
 */

export type EnvelopeInput = {
  q: string;
  /** 'all' or a specific workspace id — the requester's scope hint. */
  workspaceScope: 'all' | string;
  ts: number;
  nonce: string;
};

export type SignedEnvelope = {
  headers: Record<string, string>;
  body: string;
};

export type VerifyResult =
  | { ok: true; peerName: string; payload: { q: string; workspaceScope: string } }
  | { ok: false; kind: 'unknown_peer' | 'bad_signature' | 'stale' | 'replay' | 'malformed' };

const SKEW_MS = 300_000; // ±5 min
const NONCE_LRU = new Map<string, number>(); // nonce → expiresAt
const NONCE_LRU_CAP = 1024;

function rememberNonce(nonce: string, ts: number): boolean {
  const now = Date.now();
  // Evict expired entries lazily on every insert.
  for (const [k, exp] of NONCE_LRU) {
    if (exp < now) NONCE_LRU.delete(k);
  }
  if (NONCE_LRU.has(nonce)) return false;
  if (NONCE_LRU.size >= NONCE_LRU_CAP) {
    const first = NONCE_LRU.keys().next().value;
    if (first !== undefined) NONCE_LRU.delete(first);
  }
  NONCE_LRU.set(nonce, ts + SKEW_MS);
  return true;
}

/** Test-only: reset the nonce LRU between tests. */
export function __resetNonceLruForTests(): void {
  NONCE_LRU.clear();
}

function canonical(input: EnvelopeInput): string {
  // Concatenation order is part of the protocol; do not reorder.
  return `${input.ts}\n${input.nonce}\n${input.workspaceScope}\n${input.q}`;
}

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

export function signEnvelope(input: EnvelopeInput, secret: string): SignedEnvelope {
  const body = JSON.stringify({ q: input.q, workspaceScope: input.workspaceScope });
  const sig = hmacHex(secret, canonical(input));
  return {
    headers: {
      'content-type': 'application/json',
      'x-cairn-peer-ts': String(input.ts),
      'x-cairn-peer-nonce': input.nonce,
      'x-cairn-peer-sig': sig,
    },
    body,
  };
}

function safeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Verify an inbound peer request. Callers must read the body first (Request
 * bodies are streams) and pass the raw string + headers separately.
 *
 * On success returns the matched peer name so the inbound route knows which
 * workspace this peer is registered against.
 *
 * The replay check runs AFTER signature match so an attacker can't burn
 * legitimate nonces by spamming bad signatures.
 */
export function verifyEnvelopeWithBody(
  headers: Headers,
  rawBody: string,
  peers: ReadonlyArray<{ name: string; secret: string }>,
): VerifyResult {
  const tsHeader = headers.get('x-cairn-peer-ts');
  const nonce = headers.get('x-cairn-peer-nonce');
  const sig = headers.get('x-cairn-peer-sig');
  if (!tsHeader || !nonce || !sig) return { ok: false, kind: 'malformed' };
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) return { ok: false, kind: 'malformed' };
  if (Math.abs(Date.now() - ts) > SKEW_MS) return { ok: false, kind: 'stale' };

  let parsed: { q: string; workspaceScope: string };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, kind: 'malformed' };
  }
  if (typeof parsed.q !== 'string' || typeof parsed.workspaceScope !== 'string') {
    return { ok: false, kind: 'malformed' };
  }

  const message = canonical({ q: parsed.q, workspaceScope: parsed.workspaceScope, ts, nonce });

  for (const peer of peers) {
    const expected = hmacHex(peer.secret, message);
    if (expected.length === sig.length && safeEqHex(expected, sig)) {
      if (!rememberNonce(nonce, ts)) return { ok: false, kind: 'replay' };
      return { ok: true, peerName: peer.name, payload: parsed };
    }
  }
  return { ok: false, kind: peers.length === 0 ? 'unknown_peer' : 'bad_signature' };
}
