# Plan G — security hardening (federation + OAuth)

> **HOLD until GO.**

Five findings surfaced by the v0.9.0 federation re-audit and the v0.9.19 Plan F
OAuth investigation. Ships **before** Plan F so net-new features don't widen an
unhardened surface. Every item drives a falsifiable test at the layer that
actually catches the flaw (the F1 lesson — handler-import tests that bypass the
proxy do not count toward the gate).

Shared constraint: federation + OAuth secrets land in migrations (G1 changes a
stored-secret column shape) — every migration that changes how an existing row
behaves MUST backfill (the A3 lesson). G1's backfill is one-way (we can hash a
stored raw secret, but never recover a raw secret from an already-hashed
column), so the migration is gated on a re-pairing path being documented.

## G1 — Hash federated peer shared secrets — Backend-bug (real)

**Finding:** `peer_instances.shared_secret_hash` stores the **raw** shared
secret despite the column name — the pairing path writes the plaintext secret
and the inbound verify compares plaintext. A DB read (backup, replica, SQL
injection elsewhere) leaks every peer's live credential.

**Build:** hash on write (`scrypt`/`argon2id`, the same primitive the password
path uses), constant-time compare on verify. Migration 00NN: the column already
holds raw secrets, so the migration **re-hashes existing rows in place**
(`UPDATE … SET shared_secret_hash = hash(shared_secret_hash)` is wrong — it
double-counts on re-run; instead add a `secret_format` discriminator column
defaulting `'raw'`, hash-on-next-verify-then-rewrite, OR force re-pair). Lock
the design to: **add `secret_format` ('raw'|'scrypt'), verify accepts both,
rewrites raw→scrypt on first successful verify, new pairings always write
scrypt.** This backfills without a flag-day and without needing the plaintext.

**Failure modes verified:**
- A row written by the OLD code (raw) still authenticates, and after one
  successful verify the stored value is scrypt (spec seeds a raw row, verifies,
  asserts `secret_format='scrypt'` + value changed).
- A new pairing never writes a raw secret (spec pairs, greps the row — no
  plaintext).
- Wrong secret fails in constant time (timing-safe compare; spec asserts reject
  path doesn't early-return on length).
- Re-running the migration is idempotent (spec applies it twice — no
  double-hash, raw rows still `'raw'` until verified).

## G2 — Per-peer inbound rate limiting — Backend-gap

**Finding:** the inbound federated-peer route authenticates the shared secret
but has **no per-peer rate limit** — a compromised or hostile peer can flood
cross-instance search / sync. The auth rate-limiter (v0.5.1 T5) covers login,
not the federation surface.

**Build:** reuse the existing token-bucket limiter keyed by `peer_instance.id`
(not IP — peers sit behind one egress); configurable ceiling per peer; 429 with
`Retry-After`; the limiter state is shared across replicas via the same backend
the auth limiter uses (document if it's in-process per-replica — the
multi-replica honesty rule).

**Failure modes verified:**
- N+1 requests from one peer inside the window → the N+1th is 429 with
  `Retry-After` (spec drives the limiter directly through the route).
- A second peer is unaffected by the first peer's throttle (key isolation spec).
- 429s are audited as a peer-abuse signal, not silently dropped (spec asserts
  an audit row).
- Limiter unavailable (backend down) → **fail closed** for federation (reject),
  unlike a soft-fail login path — federation is server-to-server, a stuck
  limiter must not become an open relay (spec stubs limiter error → 503).

## G3 — Refresh-token family revocation on reuse — Backend-gap (asymmetric)

**Finding:** OAuth refresh-token **reuse** triggers single-token revocation
only, while auth-**code** reuse already family-revokes (descendant chain). An
attacker who exfiltrates a refresh token and races the legitimate client keeps a
working descendant after the victim's one token is killed.

**Build:** on detected refresh-token reuse (a token presented after it was
already rotated), revoke the **entire token family** (the rotation lineage),
matching the auth-code reuse behavior. Token rows already carry a rotation
parent link from the v0.9.19 Plan F rotation work — walk it.

**Failure modes verified:**
- Rotate A→B→C, then replay A → B and C are BOTH revoked (spec asserts all
  descendants 401, not just A).
- A legitimate single rotation does NOT revoke the family (no false positive;
  spec rotates normally, asserts the new token works).
- Family revocation is audited with the reuse trigger (spec asserts the audit
  reason names "refresh reuse").
- Two independent grants for the same client/user are separate families — one's
  reuse doesn't kill the other (family isolation spec).

## G4 — `/api/oauth/revoke` client authentication — decision + impl

**Finding:** `/api/oauth/revoke` performs **no client authentication**. RFC 7009
expects confidential clients to authenticate at the revoke endpoint; today any
caller who knows a token string can revoke it.

**This is a decision, not an auto-fix:** for the self-hosted single-operator
threat model, unauthenticated revoke is arguably acceptable (revoking a token
you already hold is low-harm). **Decide explicitly, then implement the chosen
branch.** Proposed default: **require client auth for confidential clients
(client_secret), allow public clients to revoke only their own tokens
(token-bound check), per RFC 7009 §2.1.**

**Failure modes verified:**
- A confidential client revoking without its secret → 401 (spec).
- A public client revoking a token that isn't bound to it → the request is a
  silent 200 per RFC 7009 (MUST NOT reveal token validity) BUT the token is NOT
  revoked (spec asserts the foreign token still works — the
  information-disclosure trap: 200 without action).
- A client revoking its OWN token → 200 and the token is dead (spec).
- **If the decision is "keep unauthenticated":** recorded with the threat-model
  rationale + a doc note; the spec then asserts the documented behavior (own
  token revocable) so the decision is pinned, not drifting.

## G5 — `/api/oauth/register` flood control — Backend-gap

**Finding:** `/api/oauth/register` (RFC 7591 dynamic registration) is
unauthenticated **and unthrottled** by design-of-the-spec, but with no
flood-control an attacker bloats `oauth_clients` unboundedly. D3 adds admin
*visibility + purge* (detection); G5 adds *prevention*.

**Build:** rate-limit registration per source (IP + a global ceiling), and an
admin toggle to require an initial-access-token for registration (RFC 7591
§3.1.1 allows it) — default open for the self-hosted convenience case, but the
operator can lock it. Pairs with D3's purge so detection + prevention + cleanup
all exist.

**Failure modes verified:**
- Burst of registrations from one source → throttled at the ceiling with 429
  (spec drives N+1 registrations).
- With the admin lock ON, registration without the initial-access-token → 401;
  with the token → 201 (spec toggles the setting, asserts both).
- Default (lock OFF) still allows a normal MCP client to self-register (spec —
  don't break the happy path the OAuth feature shipped for).
- Throttle counters don't leak across operators/workspaces where applicable
  (key-isolation spec).

## Cross-item note

G1 (real bug) ships first in the plan; G3 (asymmetric gap) second; G2/G5
(missing limits) and G4 (decision) follow. All five are server-side — specs hit
the route through the proxy / real auth path, never a bare handler import.
