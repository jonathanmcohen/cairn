# Cairn

[![CI](https://github.com/jonathanmcohen/cairn/actions/workflows/ci.yml/badge.svg)](https://github.com/jonathanmcohen/cairn/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/jonathanmcohen/cairn)](https://github.com/jonathanmcohen/cairn/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Your notes, on your hardware.** Cairn is a self-hosted, Notion-style
> workspace — nested pages, a rich block editor, inline databases, and
> real-time collaboration — that runs entirely on a machine you control.
> Nothing you write ever leaves your server.

Cairn gives a small team (or just you) a calm, fast place to write, plan, and
organize — without renting your knowledge base from someone else. Spin it up
with one `docker compose up`, sign in, and start writing. It's built from
scratch, MIT-licensed, and designed to be friendly to run in a homelab.

## Why Cairn?

- 🏠 **Self-hosted & private.** One Postgres + a couple of containers on your
  own box. Your content never touches a third party.
- 🧱 **Notion-shaped.** Nested pages, a slash-menu block editor, and inline
  databases with table / board / gallery / calendar / timeline views.
- 🤝 **Real-time together.** Live multi-cursor editing, comments, @mentions,
  and track-changes suggestions.
- 🔒 **Secure by default.** Strict CSP + hardening headers, optional end-to-end
  page encryption, SSO (OIDC/SAML/SCIM), TOTP & WebAuthn MFA — all off-the-shelf.
- 🧰 **Yours to extend.** A versioned HTTP API, an MCP server for AI tools,
  webhooks, automations, and two-way database connectors.
- 📱 **Works everywhere.** Responsive PWA with bounded offline, light/dark
  themes, and WCAG 2.1 AA accessibility.

## Screenshots

Each view in both light and dark themes.

### Block editor — sidebar, page, and an inline database

| Light | Dark |
|---|---|
| ![Editor (light)](docs/screenshots/editor-light.png) | ![Editor (dark)](docs/screenshots/editor-dark.png) |

### ⌘K command palette

| Light | Dark |
|---|---|
| ![Command palette (light)](docs/screenshots/command-palette-light.png) | ![Command palette (dark)](docs/screenshots/command-palette-dark.png) |

### Developer settings — API keys

| Light | Dark |
|---|---|
| ![API keys (light)](docs/screenshots/settings-api-keys-light.png) | ![API keys (dark)](docs/screenshots/settings-api-keys-dark.png) |

### Automation rules

| Light | Dark |
|---|---|
| ![Automation (light)](docs/screenshots/settings-automation-light.png) | ![Automation (dark)](docs/screenshots/settings-automation-dark.png) |

### Webhook delivery dashboard

| Light | Dark |
|---|---|
| ![Webhook deliveries (light)](docs/screenshots/webhook-deliveries-light.png) | ![Webhook deliveries (dark)](docs/screenshots/webhook-deliveries-dark.png) |

<sub>Regenerate locally with `CAIRN_CAPTURE_SCREENSHOTS=1 pnpm test:a11y` after `pnpm build`.</sub>

## Get started in 60 seconds

```sh
git clone https://github.com/jonathanmcohen/cairn.git
cd cairn
cp .env.example .env
# Edit .env — at minimum set DB_PASSWORD and AUTH_SECRET to your own values.
docker compose up -d
```

Open **http://localhost:3000** and sign up — the first account becomes the
workspace owner. That's it; you have a working knowledge base.

Prefer prebuilt images? Point your compose file at the published ones instead
of `build: .`:

```yaml
services:
  app:
    image: ghcr.io/jonathanmcohen/cairn:0.9.1
  collab:
    image: ghcr.io/jonathanmcohen/cairn-collab:0.9.1
```

```sh
docker pull ghcr.io/jonathanmcohen/cairn:0.9.1
docker pull ghcr.io/jonathanmcohen/cairn-collab:0.9.1
```

> A full deploy runs three containers — `cairn` (the app), `cairn-collab` (the
> real-time server), and `db` (Postgres) — all wired up in
> `docker-compose.yml`.

## What you can do

### ✍️ Write
A clean block editor with a slash menu (`/`) and a floating drag handle:
paragraphs, headings, lists, to-dos, quotes, syntax-highlighted code, callouts,
tables, toggles, columns, dividers, buttons, math, diagrams (Mermaid /
PlantUML / drawio), images, files, video, audio, PDFs, citations & footnotes,
and rich link unfurls. Autosave with optimistic UI; nested pages with emoji
icons and cover images.

### 🗂️ Organize with databases
Inline databases with **table, board (kanban), gallery, calendar, and
timeline** views. Properties include text, number, select, multi-select,
checkbox, date, URL, plus computed/linked types:

| Type | What it does |
|---|---|
| **Formula** | A computed cell from a safe expression (e.g. `budget * 2`, `if(done, "✓", "…")`) |
| **Relation** | Links rows to rows in another database in the same workspace |
| **Rollup** | Aggregates a property across related rows (`count`/`sum`/`avg`/`min`/`max`/…) |

Reverse relations, row hierarchies (sub-items), AND filters, grouping, and
multi-column sort. (Formula/rollup values display-only — they're computed fresh
on read, so the SQL filter/sort can't see them.)

### 🤝 Collaborate
Live multi-cursor editing with presence (Yjs + Hocuspocus), block- and
range-anchored **comments**, **@mentions**, **track-changes suggestions**, page
links + backlinks + transclusion, and a notification bell + inbox.

### 🔎 Find anything
`⌘K` command palette with full-text + typo-tolerant trigram search, optional
**semantic / hybrid vector search** (bundled local embedding model, or bring
your own endpoint), search operators + saved searches, favorites, a "see also"
related-pages panel, and a sticky table-of-contents.

### 🌐 Share
Publish any page to an unlisted, read-only `/p/<slug>` link (no login,
`noindex`), or a multi-page public site at `/s/<slug>` — with optional password
and expiry. Export a whole workspace to a buildable **MkDocs** or **Docusaurus**
site, or per-page/subtree Markdown and PDF.

### 🔐 Stay secure & in control
Multi-tenant workspaces (owner / admin / editor / viewer), email+password or
**OAuth** login, **SSO** (OIDC / SAML / SCIM), **TOTP & WebAuthn MFA** with
step-up, optional **end-to-end page encryption**, per-subtree page ACLs,
spaces, page locks, trash with retention, audit log, and encrypted backups.

### 🧰 Automate & integrate
A versioned **HTTP API** (`/api/v1`), an **MCP server** for AI assistants,
**webhooks** with a delivery dashboard, a no-code **automation rules** engine,
and two-way **database connectors** (Google Sheets, Airtable, CSV).

### 📱 Everywhere, for everyone
Responsive PWA with bounded offline (edits CRDT-merge on reconnect), quick
capture, light / dark / custom themes, keyboard shortcuts (`⌘/` cheatsheet),
i18n, and **WCAG 2.1 AA** accessibility enforced in CI.

> The full, version-by-version feature history lives in
> [CHANGELOG.md](CHANGELOG.md).

## Configuration

Only three variables are required; everything else is opt-in.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | _required_ | Postgres connection string |
| `AUTH_SECRET` | _required_ | Session signing secret (≥ 32 chars) |
| `NEXTAUTH_URL` | _required_ | Public base URL |
| `COLLAB_URL` | _required for collab_ | Public WebSocket URL of the `cairn-collab` service |
| `CAIRN_MAX_UPLOAD_MB` | `25` | Per-file upload size limit |
| `CAIRN_TRASH_RETENTION_DAYS` | `30` | Days before trash auto-purges |
| `CAIRN_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `CAIRN_METRICS_TOKEN` | _unset_ | Bearer token gating `/metrics` (≥ 16 chars). `/metrics` is **off** until set. |
| `CAIRN_BACKUP_INTERVAL` | _unset_ | Opt-in in-process backup ticker (e.g. `24h`). Off; single-instance only. |
| `CAIRN_REMINDER_INTERVAL` | _unset_ | Opt-in in-process `reminders:scan` ticker. Off; single-instance only. |
| `CAIRN_DIGEST_INTERVAL` | `0` | Opt-in email-digest ticker (minutes). `0` = off; single-instance only. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` | _unset_ | BYO-SMTP for email notifications + digests. Off until host + from are set. |

`.env.example` lists the full set, including the optional SSO, encryption,
embedding, connector, and integration keys. See
[docs/operations.md](docs/operations.md) for the backups / reminders / quotas
runbook and the external-cron pattern.

### OAuth login (optional)

Google and GitHub sign-in are an **invite-gated** alternative to
email/password — a user can only sign in via OAuth if their verified email
already has a workspace membership or a matching unused invite. A provider's
button appears only when both of its env vars are set:

| Variable | Provider |
|---|---|
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub |

Register the OAuth app with these callback URLs (where `<PUBLIC_URL>` is your
instance's base URL):

```
<PUBLIC_URL>/api/auth/callback/google
<PUBLIC_URL>/api/auth/callback/github
```

- Google: https://console.cloud.google.com/apis/credentials
- GitHub: https://github.com/settings/developers

With neither pair set, Cairn shows only the email/password form — no dead
buttons.

## Operations

### Backup & restore

A backup CLI is built into the server image. It dumps Postgres (custom format)
and, on the local file backend, archives the uploads tree into a timestamped
bundle.

```sh
# Back up the database + uploads into a directory:
docker compose exec cairn node dist/server/cli.js backup --out /data/backups

# Restore from a bundle (DESTRUCTIVE — overwrites the current DB + uploads):
docker compose exec cairn node dist/server/cli.js restore --in /data/backups/cairn-backup-<ts>.dump
```

`restore` is destructive and refuses to run unless you pass `--force` or type
the database name at the prompt. Backup bundles contain password & API-key
hashes and every uploaded file — **treat them as secrets** and copy them
off-host on a schedule (Cairn ships no off-host scheduler).

On the S3/MinIO file backend (`FILE_BACKEND=s3`), `backup` dumps the database
only — back up the bucket out-of-band. Full details, the `pg_dump`/`pg_restore`
version pin, and encrypted-backup options are in
[docs/operations.md](docs/operations.md).

### Static-site export

Export any workspace to a buildable **MkDocs** or **Docusaurus** project — pages
become Markdown, assets are bundled, and the config + nav tree are generated:

```sh
pnpm export:static -- --workspace <workspace-uuid> --target mkdocs --out site.zip
unzip site.zip -d ./site && cd ./site && mkdocs serve
```

Swap `--target docusaurus` for a Docusaurus site (with i18n routing for
translated pages). Workspaces containing encrypted pages are refused — export
is public-share-equivalent and must not leak ciphertext.

### Troubleshooting: collaboration won't connect ("Unauthorized")

Real-time editing runs in a separate `cairn-collab` service. The app mints a
short-lived, HMAC-signed collab token; `cairn-collab` verifies it. **Both
services sign and verify with the same `AUTH_SECRET`** — there is no separate
`HOCUSPOCUS_SECRET`. If the two containers have different `AUTH_SECRET` values,
every connection is rejected and the editor silently falls back to local-only
edits.

Since v0.9.6 the collab service logs the reason on each rejection, e.g.:

```
cairn-collab: rejected connect reason=bad-sig document=<page-id> tokenPageId=<page-id> exp=<unix>
```

- `reason=bad-sig` → the secrets don't match. Set the **identical** `AUTH_SECRET`
  on both `cairn` and `cairn-collab` and restart both. In `docker-compose.yml`
  both services already read `AUTH_SECRET: ${AUTH_SECRET}` from your `.env`, so a
  mismatch only happens if you override one of them.
- `reason=expired` → the token TTL (5 min) elapsed before connect; usually a
  severe clock skew between the app host and the collab host — sync clocks (NTP).
- `reason=page-mismatch` → the token was minted for a different page than the
  one requested; typically a stale client. Reload the page.

Check the logs with `docker compose logs cairn-collab`.

#### DNS resolvability

The browser connects **directly** to the collab WebSocket at `COLLAB_URL`
(and the app mints tokens against `PUBLIC_URL`), so **both hostnames must
resolve from the end-user's network**, not just from inside the Docker
network. If `COLLAB_URL`/`PUBLIC_URL` point at a hostname that resolves only
on the host (or behind a reverse proxy that isn't wired through), the client
sees a failed WebSocket handshake and the editor logs `cairn-collab: rejected
connect` / falls back to local-only edits — even though `AUTH_SECRET` matches.

Symptoms and checks:

- `cairn-collab: rejected connect` in the collab logs, or a browser-console
  WebSocket error against the `COLLAB_URL` host → confirm the host resolves
  publicly (`nslookup <collab-host>` from a client machine) and that your
  reverse proxy forwards the WebSocket upgrade headers.
- Since v0.9.8 the editor surfaces a dismissible **"Collab offline —
  reconnecting…"** banner and retries the token fetch with exponential
  backoff, so a transient DNS/proxy blip self-heals once resolution returns.

## Local development

`pnpm dev` / `build` / `test` read the same `.env` directly, so it must contain
the full set from `.env.example` (not just the docker-compose shorthand). Cairn
uses **pnpm**, **Node 24**, and Docker (for Testcontainers in the test suite).

```sh
cp .env.example .env
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # vitest (needs Docker for Testcontainers)
pnpm lint         # Biome
pnpm typecheck    # tsc
pnpm build        # Next.js standalone + entrypoint compile
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## HTTP API (v0)

A read/write JSON API under `/api/v1` for pages, databases, and rows.
Create keys under **Settings → API keys** (admin only); the full token
(`cairn_sk_…`) is shown once at creation. Send it as a bearer token:

```
Authorization: Bearer cairn_sk_<64-hex>
```

A key carries a workspace + role (`admin`/`editor`/`viewer`) and acts on behalf
of its creator; all role and workspace checks apply, and ids from another
workspace return `404`. Errors share one shape —
`{ "error": { "code": "...", "message": "..." } }` — with codes `unauthorized`
(401), `forbidden` (403), `not_found` (404), `validation` (400), `rate_limited`
(429), `internal` (500). List endpoints are cursor-paginated
(`?limit=&cursor=`, envelope `{ "data": [...], "nextCursor": ... }`) and
requests are rate-limited per key (~60 burst, ~1 req/s; single-instance).

| Method | Path | Role |
|---|---|---|
| `GET` / `POST` | `/api/v1/pages` | viewer / editor |
| `GET` / `PATCH` / `DELETE` | `/api/v1/pages/{pageId}` | viewer / editor |
| `GET` / `POST` | `/api/v1/databases` | viewer / editor |
| `GET` / `PATCH` / `DELETE` | `/api/v1/databases/{databaseId}` | viewer / editor |
| `GET` / `POST` | `/api/v1/databases/{databaseId}/rows` | viewer / editor |
| `GET` / `PATCH` / `DELETE` | `/api/v1/databases/{databaseId}/rows/{rowId}` | viewer / editor |

An interactive **OpenAPI / Swagger UI** is served at `/api-docs`, and the raw
spec at `/openapi.json`.

## Security

Cairn ships secure-by-default: a strict Content-Security-Policy plus
`nosniff` / frame-DENY / referrer / permissions-policy / HSTS hardening headers
(with a locked-down policy for public `/p/` pages), in-process rate limiting on
auth endpoints, and an adversarial regression suite (`tests/security/`) that
fails CI on tenant-isolation, RBAC, file-URL, public-sharing, injection, XSS, or
secret-leak regressions. Supply-chain advisories (`pnpm audit`) and committed
secrets (`gitleaks`) are gated in CI.

See [SECURITY.md](SECURITY.md) for the threat model, trust-boundary controls,
residual risks, and how to report a vulnerability.

## Accessibility

Cairn targets **WCAG 2.1 Level AA**. An `@axe-core/playwright` gate
(`pnpm test:a11y`) audits the editor, sidebar, database views, dialogs, and
sign-in on both light and dark themes, and runs in CI as a dedicated job that
fails the build on any AA violation. What axe can't check — screen-reader
reading order, live-region quality, keyboard feel — has a manual checklist at
[docs/a11y-screen-reader-checklist.md](docs/a11y-screen-reader-checklist.md).

## Roadmap

The v0.1 → v0.9 plan is shipped (real-time collab, public site, mobile PWA,
WCAG AA, MFA + SSO, E2E encryption, observability, quotas, backups,
import/export, search, automations, connectors, MCP, and more). Tracked toward
v1.0: filter/sort on computed values, a distributed lock for in-process
schedulers (today: external cron), and native mobile apps.

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## License

MIT — see [LICENSE](LICENSE). Built from scratch, not derived from any other
Notion alternative.
