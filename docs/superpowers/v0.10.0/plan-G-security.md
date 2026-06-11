# Plan G — security hardening (federation + OAuth)

> **HOLD until GO.**

Five findings surfaced by the federation re-audit done for this scaffold
(2026-06-10) and the v0.9.19 Plan F OAuth investigation
(`docs/superpowers/v0.9.19/plan-F-mcp-oauth-verify.md`). Ships **before** Plan
F so net-new features don't widen an unhardened surface. Every item drives a
falsifiable test at the layer that actually catches the flaw (the F1 lesson —
handler-import tests that bypass the proxy do not count toward the gate).

Shared constraint: G1 and G3 land migrations — every migration that changes how
an existing row behaves MUST backfill (the A3 lesson).

## G1 — Protect federated peer shared secrets at rest — Backend-bug (real)

**Finding:** `peer_instances.shared_secret_hash` stores the **raw** shared
secret despite the column name. The inbound verify
(`/api/search/federated/peer/route.ts:42` → `peer-hmac.ts:128-135`) uses the
stored value as the **HMAC-SHA256 key** to recompute and timing-safe-compare
envelope signatures (`peer-hmac.ts:88-91` — the compare is already
constant-time). A DB read (backup, replica, SQL injection elsewhere) leaks
every peer's live credential.

**Design constraint the review surfaced: hashing is impossible here.** HMAC
verification needs the raw key at verify time — a one-way hash would break the
protocol. So the fix is **encrypt-at-rest**, not hash: wrap the secret with
AES-256-GCM under an operator env key (reuse the
`CAIRN_BACKUP_ENCRYPTION_PASSPHRASE`-style envelope primitive from
`src/lib/backups/encryption.ts`), decrypt only in the verify path. (The
alternative — switching the federation protocol to asymmetric signatures — is
a breaking cross-instance change; out of scope, recorded.)

**Build:** new env key `CAIRN_PEER_SECRET_KEY` (required to enable federation
once set); encrypt on pairing write; decrypt at verify; rename the column or
add `secret_format` ('raw'|'enc-v1') so the migration backfills without a
flag-day: verify accepts both, re-encrypts a raw row on first successful
verify, new pairings always write encrypted. Document the rotation path
(re-pair) and that an operator who never sets the key keeps today's raw-at-rest
behavior with a startup warning — never a silent lock-out of existing peers.

**Failure modes verified:**
- A row written by the OLD code (raw) still authenticates, and after one
  successful verify the stored value is `enc-v1` (spec seeds a raw row,
  verifies, asserts format + value changed).
- A new pairing never writes a raw secret when the key is set (spec pairs,
  greps the row — no plaintext).
- Wrong env key (rotated/lost) → verify fails CLOSED with a clear operator
  error naming the env var, never an open relay or a crash-loop.
- Re-running the migration is idempotent (spec applies it twice — no
  double-encrypt, raw rows still `'raw'` until verified).
- Signature compare stays timing-safe end-to-end (already true at
  `peer-hmac.ts:88-91`; spec pins it so the refactor can't regress it).

## G2 — Per-peer inbound rate limiting — Backend-gap

**Finding:** the inbound federated-peer route authenticates the shared secret
but has **no per-peer rate limit** — a compromised or hostile peer can flood
cross-instance **search** (the only peer-authenticated inbound surface; there
is no inbound sync route — `last_synced_at` is bookkeeping). Each request costs
an O(N)-HMAC sweep over all peers plus a full FTS query
(`/api/search/federated/peer/route.ts:31-67`), so the amplification is real.
The auth rate-limiter (v0.5.1 T5) covers login, not this surface.

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

**Finding (worse than first ledgered):** refresh-token reuse is not just
under-punished — it is **not even detected**. `refreshTokens`
(`src/lib/oauth/exchange.ts:150-187`) looks up the presented hash `WHERE
revoked_at IS NULL`; a replayed (already-rotated) token finds no row and
returns a generic `invalid_grant` indistinguishable from a junk token, while
the attacker's rotated descendant keeps working. Meanwhile auth-**code** reuse
(`exchange.ts:60-77`) blanket-revokes every token for the same
user+client+workspace. The asymmetry is real; the mechanism to fix it does not
exist yet: **`oauth_tokens` has no rotation-lineage column**
(`src/db/schema/oauth-tokens.ts:11-36` — no parent/family field; migration
0069 confirms).

**Build (three pieces, not a lineage walk):**
1. Migration: add `family_id` (uuid) to `oauth_tokens`; backfill existing rows
   with a fresh family each; the rotation insert copies the parent's family.
2. Detection: on refresh, look the hash up **including revoked rows** — a hit
   on a revoked-by-rotation row IS the reuse signal (today's `isNull` filter
   hides it).
3. Response: revoke the whole `family_id` set, matching (and scoping better
   than) the code-reuse blanket.

**Failure modes verified:**
- Rotate A→B→C, then replay A → B and C are BOTH revoked (spec asserts all
  descendants 401, not just A). RED today — the replay currently returns
  invalid_grant and C keeps working.
- A legitimate single rotation does NOT revoke the family (no false positive;
  spec rotates normally, asserts the new token works).
- Family revocation is audited with the reuse trigger (spec asserts the audit
  reason names "refresh reuse"); today the event doesn't exist at all.
- Two independent grants for the same client/user are separate families — one's
  reuse doesn't kill the other (family isolation; NOTE this is intentionally
  narrower than the code-reuse blanket, which kills sibling grants — record the
  difference, don't accidentally "fix" code-reuse to match).
- Backfilled pre-migration rows each form their own family (the A3 backfill
  lesson; spec asserts an old token's reuse doesn't revoke an unrelated old
  token).

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
