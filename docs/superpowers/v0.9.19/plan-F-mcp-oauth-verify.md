# Plan F — MCP OAuth: live-verify + e2e guard

**Honest scoping:** the v0.9.16 Plan F
(`docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md`) was fully implemented —
migration 0069 (oauth_clients / oauth_authorization_codes / oauth_tokens),
PKCE S256 libs, RFC 8414 discovery, RFC 7591 dynamic registration, authorize +
consent, token exchange, refresh rotation, RFC 7009 revocation, resolveToken
oauth branch, MCP WWW-Authenticate challenge, settings UI. All 11 tasks have
unit/integration specs. What it has NEVER had: a live-deployment verification
or a runtime e2e of the full browser consent flow. v0.9.18's lesson applies
directly: "implemented + unit-tested" ≠ "works live" (see A3/#37 in the
audit). This plan is verification-first; code changes only for what
verification breaks.

## F1 — full-flow runtime verification

**Files:** `tests/e2e/item-F-mcp-oauth-flow.spec.ts` (new); fix-files TBD by
what the spec finds (most likely candidates: redirect-URI/origin handling
behind the proxy, cookie SameSite on the consent screen, discovery URLs when
`PUBLIC_URL` differs from the bind address).

- Spec drives the real OAuth 2.1 flow against the booted app, acting as an
  MCP client:
  1. `GET /.well-known/oauth-authorization-server` → assert metadata
     (endpoints, S256, registration endpoint).
  2. POST dynamic registration → client_id.
  3. Authorize URL with PKCE challenge → logged-in browser context hits the
     consent screen → approve → capture code from redirect.
  4. Exchange code + verifier → access/refresh tokens.
  5. Call the MCP endpoint with the access token → 200 + tool list (and
     without → 401 + `WWW-Authenticate` challenge).
  6. Refresh rotation: old refresh token invalid after use.
  7. Revoke → MCP call now 401.
- Live-deploy verification artifact (per v0.9.19 gates): the same flow
  click-through on the preview deployment, screenshots of consent screen +
  connected client in settings.

**Coverage:** discovery, registration, PKCE happy path, MCP challenge,
rotation, revocation — the full advertised loop, runtime layer, single spec.

**Failure modes verified:**

- Wrong-verifier exchange → 400 (negative asserted in spec).
- Reused refresh token → revoked family (rotation theft detection per the
  v0.9.16 design) — asserted.
- Unauthenticated MCP call → 401 challenge with correct `resource_metadata`
  URL — asserted.
- Behind-proxy origin mismatch (PUBLIC_URL vs localhost) — the most likely
  real-world live failure; spec runs with `PUBLIC_URL` set to a value
  different from the bind host to force the class.
- If live verification finds breakage: each fix is its own commit on this
  item's branch with the red→green spec delta pasted in the PR; if the
  breakage exceeds this item's scope (e.g. a design flaw), STOP and report
  instead of expanding scope silently.
