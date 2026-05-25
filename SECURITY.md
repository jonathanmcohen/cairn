# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.6.x   | ✅ |
| 0.5.x   | ✅ (previous) |
| < 0.5   | ❌ (upgrade) |

Cairn is self-hosted; "supported" means security fixes land on the latest 0.6.x (and 0.5.x for one release) and are released as a patch tag.

## Reporting a vulnerability

Do **not** open a public issue for a security report. Email the maintainer at the address in the repo's GitHub profile (or open a GitHub **private security advisory** on `github.com/jonathanmcohen/cairn`). Include reproduction steps and affected version. Expect an acknowledgement within a few days; this is a homelab-scale project maintained best-effort.

## Threat model (STRIDE-lite)

Cairn is a single Next.js container + Postgres for homelab/small-team deployment. Trust boundaries and the controls at each (mirrors the v0.5.1 design spec §2; v0.6.0 additions noted inline):

| Trust boundary | Threats (STRIDE) | Controls |
|---|---|---|
| Browser ↔ Next (app) | Spoofing, Tampering, Info-disclosure | Auth.js v5 JWT sessions; `httpOnly`/`sameSite=lax`/`secure`(prod) cookies; CSP + hardening headers; CSRF via same-site + Auth.js |
| AuthN | Spoofing, brute force | bcrypt credentials; OAuth invite-gate; **login/signup rate limiting** (5/3 per min per ip+identifier); **TOTP 2FA + recovery codes** (v0.6.0, see below) |
| AuthZ / RBAC | Elevation of privilege | `requireRole`/`hasMinRole`/`requirePageAccess`; `owner>admin>editor>viewer`; adversarial RBAC test suite |
| Multi-tenant isolation | Info-disclosure, EoP | Every query workspace-scoped; cross-workspace → **404** (existence never leaked); table-driven isolation test suite |
| File access | Info-disclosure, Tampering | HMAC-signed URLs (`?sig=&exp=`); signature is the only gate; no path traversal; forge/expiry test suite |
| Public sharing (`/p/`, `/s/<slug>`) | Info-disclosure | Gated on `published=true AND deleted_at IS NULL`; `noindex`; locked-down CSP; embedded DB readable only while host published; leakage test suite. v0.6.0: password-protected pages via Argon2id + HMAC-signed access cookie (reusing v0.5.0 file-URL signer); unknown/expired/unpublished → 404 (never 403) |
| Collab WS | Spoofing, Tampering | Short-lived (5 min) collab JWT; `authorizeCollab` checks `token.pageId === doc`; viewer read-only; forge/expiry/wrong-page test suite |
| API keys (v0.5.0) | Spoofing, EoP | sha256-hashed keys, prefix shown once; bearer auth; can't exceed role; rate-limited; revoke/expiry test suite |
| Outbound webhooks (v0.5.0) | SSRF, Tampering | Per-hook HMAC signature; SSRF guard blocks loopback/link-local/private targets |
| Input handling | Injection (SQLi/XSS) | Zod on every body; Drizzle parameterized SQL (raw CTEs parameterized); public render walks typed ProseMirror nodes (no raw HTML) — injection + XSS test suites |
| Embeds / iframes (v0.6.0) | XSS, clickjacking | Allowlist-only: YouTube / Vimeo / Figma / gist / CodeSandbox; HTTPS-only; sandboxed; CSP `frame-src` drift-guarded by test. Bookmark unfurl (`/api/unfurl`) SSRF-guarded |
| Secrets | Info-disclosure | `AUTH_SECRET`/DB/S3/webhook secrets via env; never in API responses, logs, or client bundle (only `NEXT_PUBLIC_*`); secret-leak test + bundle scan; gitleaks in CI; v0.6.0: TOTP secret AES-256-GCM-encrypted at rest, recovery codes SHA-256-hashed, `pino` redact list extended (see below) |
| Storage (v0.6.0) | DoS via fill | Workspace storage quota enforced at the upload choke point **before** any blob is written; `QuotaExceededError` when `used + incoming > limit` (null = unlimited); transactional counter + `reconcileQuota` drift backstop |
| Observability (v0.6.0) | Info-disclosure, EoP | `/metrics` **off by default** (404 unless `CAIRN_METRICS_TOKEN` set); timing-safe bearer compare; aggregate-only labels (no tenant/user/page ids); `route` label normalized through `routeTemplate()` (cardinality guard test) |
| Audit log (v0.6.0) | Repudiation, Info-disclosure | Sensitive actions write an `audit_log` row in the same transaction; `assertAuditMetadataClean` redaction guard rejects metadata containing secrets; admin viewer at `/settings/admin/audit` (admin+) |
| Supply chain | Tampering | `pnpm audit --audit-level=high` (time-boxed reviewed ignore list); lockfile; release SLSA provenance/SBOM on public deploys |

## v0.8.0 additions

### New secret class — Unsplash access key
- **`CAIRN_UNSPLASH_ACCESS_KEY`** is added to `FORBIDDEN_KEYS` (the v0.7
  secret-leak suite asserts the key never appears in any API response,
  audit metadata, token-usage log, or workspace-archive export). The same
  key is added to `pino`'s redact list. The cover picker uses the key
  client-side ONLY via a search-flow that hits Unsplash directly; the
  server never proxies the search. The configuration API never returns the
  key (explicit assertion).
- If the env is unset, the cover picker degrades to color + upload tabs
  only — no broken UI surface, no key-leak failure mode.

### New runtime surface — Playwright + Chromium (opt-in)
- **`@playwright/test`** moves from dev-dep to runtime dep in v0.8.0
  (G9 P25). The Chromium binary it bundles adds ~150MB to the image when
  `CAIRN_NATIVE_PDF=1` is used; the binary is otherwise dormant.
- The native PDF route holds a singleton `Browser` instance per process
  (lazy-launched on first request, closed on `SIGTERM`/`SIGINT`). The
  `pageToPdf` helper does not accept arbitrary URLs — it renders the
  in-process `pageToPdfHtml(page)` string via `page.setContent(...)`, so
  there is no SSRF surface from this path.
- The MCP `pages.export` tool with `format=pdf` rejects with
  `INVALID_REQUEST` when `CAIRN_NATIVE_PDF` is unset (does not silently
  fall back to HTML — the MCP envelope cannot deliver a "Save as PDF"
  HTML page).

### New client-side persistence — Yjs over IndexedDB
- Every opened page is mirrored to IndexedDB for the workspace session
  (G1 P1). This is **client-side state only** — no new server-side
  secrets, no quota impact on the server.
- FIFO eviction at `CAIRN_OFFLINE_DOC_LIMIT_MB` (default 256MB) keeps the
  browser's storage from growing without bound. The per-workspace index
  + eviction job live in `src/lib/offline/{doc-index,evict}.ts` and are
  unit-tested against `fake-indexeddb`.
- IndexedDB is per-browser-tab — no cross-instance synchronization
  concern. If a user opens the workspace in two tabs, each maintains its
  own mirror; Yjs CRDT reconciles edits when both tabs reconnect.

### New CSP `frame-src` entries (G8 P22)
- The embed allowlist adds: Loom (`*.loom.com`), Codepen
  (`*.codepen.io`), Spotify (`*.spotify.com`), Vimeo Showcase
  (`*.vimeo.com`), Mermaid (rendered as a data-URL iframe — no
  third-party origin), Excalidraw (`excalidraw.com`). Each addition is
  reflected in the per-route CSP `frame-src` directive and asserted by
  `tests/lib/security/embed-allowlist.test.ts` so accidental removal
  fails the build.

### New manifest entry — `share_target`
- The PWA `manifest.webmanifest` declares a `share_target` accepting
  title + text + URL POSTed to `/api/inbox`. Browser support is
  Chromium-only as of v0.8.0; Firefox + Safari ignore the entry. The
  route enforces the same PAT / session gate as every other `/api/...`
  surface — no anonymous capture path.

### Operational ceilings — unchanged
- No new in-process schedulers in v0.8.0. The single-instance ceiling
  documented in v0.7 (cron_schedules + automation event-subscriber +
  connector sync orchestrator, on top of the v0.6 backup/reminders/digest
  tickers) is the full set.

## v0.7.0 additions

### New token class
- **Personal Access Tokens (`cairn_pat_*`).** Per-user, multi-scope, with a
  per-token MCP tool allowlist. Stored only as a SHA-256 hash; the plaintext is
  shown ONCE at mint via a dialog with copy + download buttons and never
  persisted client-side or echoed in any API response. `FORBIDDEN_SECRET_PREFIXES`
  includes `cairn_pat_`. PATs coexist with v0.5 `cairn_sk_` API keys (separate
  table, separate audit-event prefix `pat.*` vs `api_key.*`) so the token-usage
  log can attribute correctly.

### Page ACLs + precedence
- Effective permission for `(user, page)` = explicit ACL on the page if one
  exists; else inherit from the nearest ancestor with an ACL; else fall through
  to the user's workspace role. **Owner role bypasses the ACL chain entirely.**
- Public-share (`/p/<slug>`) is a separate axis — applies only to anonymous
  visitors; logged-in members always route through role + ACL.
- ACL inheritance is a recursive CTE walking `pages.parent_id` upward, wrapped
  in React `cache()` per request; the depth in typical Notion-shaped trees is
  ≤ ~10.

### MCP server
- Tool dispatch enforces three layers in order: (1) PAT carries the tool's
  declared scope, (2) tool ID is in the PAT's allowlist, (3) the acting user's
  workspace role + page ACL permits the underlying mutation. An empty allowlist
  blocks all MCP access regardless of scopes.
- Every tool invocation logs to `token_usage_log` (success and error). MCP-side
  rate-limit reuses the v0.5.1 in-process token-bucket keyed by (token_id, tool_id).
- New `AuditAction` literals: `pat.created`, `pat.revoked`, `pat.expired`,
  `page_acl.{created,changed,removed}`. `mcp.tool_called` events go to
  `token_usage_log` only (not `audit_log`) — too high-cardinality for the audit feed.

### Embedding secrets
- `CAIRN_EMBEDDING_API_KEY` is in `pino`'s redact list. `FORBIDDEN_KEYS`
  includes it. Bundled local model needs no key; only the BYO remote path uses one.

### Two-way connector secrets
- Sheets OAuth refresh tokens, Airtable PATs, and Airtable webhook MAC secrets
  all live encrypted in `database_connectors.auth_config` (v0.6 secret-box;
  AES-256-GCM, key = HKDF of `AUTH_SECRET`). Decrypted only inside the sync
  engine. Never echoed in API responses, audit metadata, token-usage log, or
  workspace export (asserted by the extended secret-leak suite — P22).
- CSV adapter resolves relative paths under `CAIRN_CONNECTOR_CSV_PATH` and
  rejects paths whose resolved form escapes the mount prefix.

### Operational ceilings — new schedulers
- **Single-instance:** the `cron_schedules` ticker (scheduled backups), the
  automation event-subscriber loop, and the connector sync orchestrator are
  all opt-in in-process tickers. Multiple instances double-fire all three.
  This is the same ceiling v0.6 documented for the backup/reminders/digest
  tickers — extended now to cover three more loops.

### Observability gating (unchanged)
- `/metrics` token-gating from v0.6 P20 is unchanged. New series carry
  closed labels (`tool`, `kind`, `provider`, `action_type`, `outcome`) and
  no tenant identifiers.

### New always-open surface
- `GET /healthz` is open (no auth). Returns minimal JSON
  `{ status, version, db, uptime_seconds }`. Touches the DB with a `SELECT 1`
  for liveness; returns 503 on DB failure. Safe to expose on a load balancer.

## v0.6.0 additions

### Authentication: TOTP 2FA + recovery codes (P19)

- Per-user enrollment with QR + manual key + **10 recovery codes shown ONCE**.
- TOTP secret stored **encrypted at rest** (AES-256-GCM with HKDF-derived key from `AUTH_SECRET` — `src/lib/crypto/secret-box.ts`).
- Recovery codes **hashed at rest** (SHA-256 over normalized form, single-use, consumed atomically).
- Sign-in second-factor challenge runs inside the credentials `authorize` callback.
- **`require_2fa` workspace gate:** owner must enroll BEFORE the flag can be turned on (precondition enforced at the workspace-settings action level, P17). Once enabled, the `(app)` layout enforces enrollment for every member — unenrolled members are routed to an enrollment screen on next request. `src/proxy.ts` pipes the request path via `x-pathname` so the layout can branch.
- Lockout recovery: a `totp:disable` CLI subcommand is deferred to a future release; for now, owners with DB access can clear the row.

### Observability: `/metrics` endpoint (P20)

- **OFF by default** — returns 404 when `CAIRN_METRICS_TOKEN` is unset.
- With token set: 401 on missing/wrong bearer (timing-safe compare); 200 with Prometheus exposition on the right token.
- All metric labels are aggregate-only — no tenant, user, or page identifiers leak through.
- The `route` label always passes through `routeTemplate()`; cardinality guard test loads 1000 distinct ids and asserts exactly 1 series.
- `pino` JSON logger redact list (v0.6.0): `passwordHash`, `tokenHash`, `secret`, `secret_encrypted`, `recovery_codes`, `authorization`, `cookie`, `AUTH_SECRET`, `CAIRN_METRICS_TOKEN`, `sig`.

### Audit log + activity feed (P18)

Every sensitive action records an `audit_log` row in the same transaction as the action itself:

- publish / share-change
- API key mint / revoke
- webhook create / delete
- page soft-delete
- database archive
- workspace member role change / remove
- invite create / revoke
- template save
- version restore

`assertAuditMetadataClean` rejects metadata containing `AUTH_SECRET`, `cairn_whsec_`, `cairn_sk_`, `token_hash`, `password_hash`, `secret_encrypted`, or any secret-ish key paired with a long base64 value. Admin-only viewer at `/settings/admin/audit`.

### Workspace storage quotas (P21)

Enforced at the file-upload choke point **before** any blob is written. `QuotaExceededError` when `used + incoming > limit` (null limit = unlimited). The counter is maintained transactionally; drift backstop via `reconcileQuota` recomputes from `SUM(files.size)` (CLI: `reconcile`).

### Workspace export — secrets excluded (P21)

The re-importable archive contains pages + databases + files + manifest. It **explicitly excludes**:

- `api_keys`
- `webhooks` (URL + shared secret)
- `user_totp` (encrypted secret bytea)
- password hashes
- recovery codes

The secret-leak suite (extended in P19) asserts the encrypted TOTP secret, the recovery-code hashes, and the plaintext TOTP material never appear in API responses, audit metadata, the workspace-members listing, the webhooks listing, or the admin-audit listing.

### Anonymous public surfaces (P7)

- Password-protected pages: **Argon2id** (via `@node-rs/argon2`) for the password hash; HMAC-signed access cookie reusing the v0.5.0 file-URL signer (no new secret introduced).
- Public site `/s/<workspace-slug>` lists only explicitly-published pages.
- Expired / unpublished / unknown → **404** (never 403 — avoids enumeration).
- CSP `frame-src` allowlists only the embed providers; a test fails the build if the list drifts.

### Embed allowlist (P5)

Only YouTube / Vimeo / Figma / gist / CodeSandbox iframes accepted; HTTPS-only; sandboxed. Arbitrary iframe embeds are **explicitly out of scope**. The bookmark unfurl service (`/api/unfurl`) is SSRF-guarded with the same blocklist as outbound webhooks.

## Secret classes

The following classes of secret exist in a running Cairn instance. None of these should ever appear in API responses, audit metadata, exports, logs (`pino` redact list above), or the client bundle. The secret-leak test suite asserts each one.

| Class | Where it lives | Notes |
|---|---|---|
| `AUTH_SECRET` | env | Auth.js JWT + HMAC URL signer + HKDF input for TOTP secret-box |
| `CAIRN_METRICS_TOKEN` (v0.6.0) | env | Bearer for `/metrics`; absence disables the endpoint entirely |
| DB / S3 / SMTP credentials | env | Standard env-only |
| `cairn_sk_*` (API keys, v0.5.0) | DB (`api_keys.token_hash`) | sha256-hashed; plaintext shown once at mint |
| `cairn_whsec_*` (webhook secrets, v0.5.0) | DB (`webhooks.secret`) | Shown once at create; used to sign outbound payloads |
| User password hash | DB (`users.passwordHash`) | bcrypt |
| TOTP secret (v0.6.0) | DB (`user_totp.secret_encrypted` bytea) | AES-256-GCM, key = HKDF(`AUTH_SECRET`) |
| Recovery codes (v0.6.0) | DB (`user_totp.recovery_codes` — hashes) | SHA-256 over normalized form; single-use, consumed atomically |

## Residual / accepted risks (homelab threat profile)

- **In-process rate limiting and webhook delivery are single-instance.** No distributed/Redis limiter — acceptable at homelab scale; documented, not a regression.
- **Single-instance scheduling ceiling (v0.6.0).** `CAIRN_BACKUP_INTERVAL`, `CAIRN_REMINDER_INTERVAL`, and `CAIRN_DIGEST_INTERVAL` tickers are OFF by default and **single-instance only** — two app instances each run their own ticker and double-fire. No distributed lock in the v1.0 line (consistent with the single-instance Hocuspocus collab assumption). Multi-instance deployments should disable the in-app tickers and drive these from external cron.
- **PWA offline scope (v0.6.0, P13).** The `y-indexeddb` offline buffer is bounded to recently-opened pages and resyncs on reconnect; this is not a full offline-first sync engine. Conflict resolution and full offline editing of arbitrary pages are deferred.
- **No external DAST in CI.** Reproducible Vitest adversarial tests + a security smoke instead; an optional manual OWASP ZAP pass is described below.
- **No WAF, no bot/CAPTCHA, no SSO/SAML.** Out of scope for the 0.x line. (2FA/MFA landed in v0.6.0; SSO/SAML remain out of scope.)
- **Encryption at rest** for the database and file blobs relies on the host/Postgres, not application-level. The TOTP secret is the one application-level-encrypted column (v0.6.0). No E2E encryption of page content.

## Optional manual DAST

For a deeper pass, run OWASP ZAP against a staging instance: baseline scan of the app origin, authenticated scan with a session cookie, and confirm the headers + the `/p/` and `/s/<slug>` policies. Not wired into CI by design.
