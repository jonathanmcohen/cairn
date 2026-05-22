# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.5.x   | ✅ |
| < 0.5   | ❌ (upgrade) |

Cairn is self-hosted; "supported" means security fixes land on the latest 0.5.x and are released as a patch tag.

## Reporting a vulnerability

Do **not** open a public issue for a security report. Email the maintainer at the address in the repo's GitHub profile (or open a GitHub **private security advisory** on `github.com/jonathanmcohen/cairn`). Include reproduction steps and affected version. Expect an acknowledgement within a few days; this is a homelab-scale project maintained best-effort.

## Threat model (STRIDE-lite)

Cairn is a single Next.js container + Postgres for homelab/small-team deployment. Trust boundaries and the controls at each (mirrors the v0.5.1 design spec §2):

| Trust boundary | Threats (STRIDE) | Controls |
|---|---|---|
| Browser ↔ Next (app) | Spoofing, Tampering, Info-disclosure | Auth.js v5 JWT sessions; `httpOnly`/`sameSite=lax`/`secure`(prod) cookies; CSP + hardening headers; CSRF via same-site + Auth.js |
| AuthN | Spoofing, brute force | bcrypt credentials; OAuth invite-gate; **login/signup rate limiting** (5/3 per min per ip+identifier) |
| AuthZ / RBAC | Elevation of privilege | `requireRole`/`hasMinRole`/`requirePageAccess`; `owner>admin>editor>viewer`; adversarial RBAC test suite |
| Multi-tenant isolation | Info-disclosure, EoP | Every query workspace-scoped; cross-workspace → **404** (existence never leaked); table-driven isolation test suite |
| File access | Info-disclosure, Tampering | HMAC-signed URLs (`?sig=&exp=`); signature is the only gate; no path traversal; forge/expiry test suite |
| Public sharing (`/p/`) | Info-disclosure | Gated on `published=true AND deleted_at IS NULL`; `noindex`; locked-down CSP; embedded DB readable only while host published; leakage test suite |
| Collab WS | Spoofing, Tampering | Short-lived (5 min) collab JWT; `authorizeCollab` checks `token.pageId === doc`; viewer read-only; forge/expiry/wrong-page test suite |
| API keys (v0.5.0) | Spoofing, EoP | sha256-hashed keys, prefix shown once; bearer auth; can't exceed role; rate-limited; revoke/expiry test suite |
| Outbound webhooks (v0.5.0) | SSRF, Tampering | Per-hook HMAC signature; SSRF guard blocks loopback/link-local/private targets |
| Input handling | Injection (SQLi/XSS) | Zod on every body; Drizzle parameterized SQL (raw CTEs parameterized); public render walks typed ProseMirror nodes (no raw HTML) — injection + XSS test suites |
| Secrets | Info-disclosure | `AUTH_SECRET`/DB/S3/webhook secrets via env; never in API responses, logs, or client bundle (only `NEXT_PUBLIC_*`); secret-leak test + bundle scan; gitleaks in CI |
| Supply chain | Tampering | `pnpm audit --audit-level=high` (time-boxed reviewed ignore list); lockfile; release SLSA provenance/SBOM on public deploys |

## Residual / accepted risks (homelab threat profile)

- **In-process rate limiting and webhook delivery are single-instance.** No distributed/Redis limiter — acceptable at homelab scale; documented, not a regression.
- **No external DAST in CI.** Reproducible Vitest adversarial tests + a security smoke instead; an optional manual OWASP ZAP pass is described below.
- **No WAF, no bot/CAPTCHA, no 2FA/MFA, no SSO/SAML.** Out of scope for the 0.x line.
- **Encryption at rest** relies on the host/Postgres, not application-level; no E2E encryption.

## Optional manual DAST

For a deeper pass, run OWASP ZAP against a staging instance: baseline scan of the app origin, authenticated scan with a session cookie, and confirm the headers + the `/p/` policy. Not wired into CI by design.
