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
