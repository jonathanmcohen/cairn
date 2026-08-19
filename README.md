# Cairn

[![CI](https://github.com/jonathanmcohen/cairn/actions/workflows/ci.yml/badge.svg)](https://github.com/jonathanmcohen/cairn/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/jonathanmcohen/cairn)](https://github.com/jonathanmcohen/cairn/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Your notes, on your hardware.** Cairn is a self-hosted, Notion-style
> workspace — nested pages, a rich block editor, inline databases, real-time
> collaboration, and a built-in spaced-repetition study system — that runs
> entirely on a machine you control. Nothing you write ever leaves your server.

Cairn gives a small team (or just you) a calm, fast place to write, plan, study,
and organize — without renting your knowledge base from someone else. It's one
`docker compose up`: the app, a real-time collaboration server, and Postgres.
Sign up, and the first account becomes the workspace owner. Built from scratch,
MIT-licensed, and designed to be friendly to run in a homelab.

## Why Cairn?

- 🏠 **Self-hosted & private.** Two app containers + Postgres on your own box.
  Your content never touches a third party.
- 🧱 **Notion-shaped.** Nested pages, a slash-menu block editor, and inline
  databases with table / board / gallery / calendar / timeline views.
- 🤝 **Real-time together.** Live multi-cursor editing, presence, comments,
  @mentions, and track-changes suggestions.
- 🧠 **Learn what you write.** A first-class flashcard system — turn any note
  into spaced-repetition cards (SM-2), study by deck, track retention, and
  export to Anki.
- 🔒 **Secure by default.** Strict CSP + hardening headers, optional end-to-end
  page encryption, SSO (OIDC / SAML / SCIM), and TOTP & WebAuthn MFA.
- 🧰 **Yours to extend.** A versioned HTTP API, an MCP server for AI tools,
  webhooks, automations, and two-way database connectors.
- 📱 **Works everywhere.** Responsive PWA with bounded offline, light / dark /
  custom themes, and WCAG 2.1 AA accessibility enforced in CI.

## Screenshots

Every surface in both light and dark themes.

### Block editor — sidebar, page, and an inline database

| Light | Dark |
|---|---|
| ![Editor (light)](docs/screenshots/editor-light.png) | ![Editor (dark)](docs/screenshots/editor-dark.png) |

### Flashcards — statistics dashboard

| Light | Dark |
|---|---|
| ![Flashcard stats (light)](docs/screenshots/flashcards-stats-light.png) | ![Flashcard stats (dark)](docs/screenshots/flashcards-stats-dark.png) |

### Flashcards — card manager

| Light | Dark |
|---|---|
| ![Flashcard manager (light)](docs/screenshots/flashcards-manage-light.png) | ![Flashcard manager (dark)](docs/screenshots/flashcards-manage-dark.png) |

### ⌘K command palette

| Light | Dark |
|---|---|
| ![Command palette (light)](docs/screenshots/command-palette-light.png) | ![Command palette (dark)](docs/screenshots/command-palette-dark.png) |

### Search

| Light | Dark |
|---|---|
| ![Search (light)](docs/screenshots/search-light.png) | ![Search (dark)](docs/screenshots/search-dark.png) |

### Developer & admin — API keys · automation · webhook deliveries

| Light | Dark |
|---|---|
| ![API keys (light)](docs/screenshots/settings-api-keys-light.png) | ![API keys (dark)](docs/screenshots/settings-api-keys-dark.png) |
| ![Automation (light)](docs/screenshots/settings-automation-light.png) | ![Automation (dark)](docs/screenshots/settings-automation-dark.png) |
| ![Webhook deliveries (light)](docs/screenshots/webhook-deliveries-light.png) | ![Webhook deliveries (dark)](docs/screenshots/webhook-deliveries-dark.png) |

<sub>Regenerate locally with `CAIRN_CAPTURE_SCREENSHOTS=1 pnpm test:a11y` after `pnpm build`.</sub>

## Get started in 60 seconds

You need **Docker** (Engine 20.10+ with Compose v2). Everything else runs in
containers — all images are public on GHCR, so no login is required.

```sh
git clone https://github.com/jonathanmcohen/cairn.git
cd cairn
cp .env.example .env

# Set the three required secrets in .env:
#   DB_PASSWORD   – any strong password
#   AUTH_SECRET   – openssl rand -base64 32
#   PUBLIC_URL    – where you'll reach Cairn (http://localhost:3000 to start)

docker compose up -d
```

Open **http://localhost:3000** and sign up — the **first account becomes the
workspace owner**. That's it: you have a working knowledge base. Database
migrations run automatically on container start.

> **Pin your version.** Set `CAIRN_VERSION=0.10.2` in `.env` for reproducible
> deploys (it locks both the `cairn` and `cairn-collab` images to the same
> release). Omit it to track `latest`.

A full deploy is **three containers**, all wired up in `docker-compose.yml`:

| Service | Image | Port | What it is |
|---|---|---|---|
| `cairn` | `ghcr.io/jonathanmcohen/cairn` | `3000` | The app (Next.js, single process) |
| `cairn-collab` | `ghcr.io/jonathanmcohen/cairn-collab` | `1234` | Real-time collaboration server (Hocuspocus) |
| `db` | `ghcr.io/jonathanmcohen/pgvector:18-0.8.6` | - | Postgres 18 + `pgvector` (for semantic search) |

Persistent state lives in two named volumes: `cairn_uploads` (uploaded files)
and `cairn_db` (the database).

### Putting it on the internet (HTTPS)

For a real deployment behind a domain, use the bundled Caddy reverse-proxy
overlay — it terminates TLS on `:443` and proxies both the app and the collab
WebSocket:

```sh
# In .env: set CAIRN_DOMAIN, and switch PUBLIC_URL to https://<domain>
#          and COLLAB_URL to wss://<domain>/collab
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
```

See [docs/deployment.md](docs/deployment.md) for the full reverse-proxy and TLS
guide.

## What you can do

### ✍️ Write
A clean block editor with a slash menu (`/`) and a floating drag handle:
paragraphs, headings, lists, to-dos, quotes, syntax-highlighted code, callouts,
tables, toggles, columns, dividers, buttons, math (KaTeX), diagrams (Mermaid /
PlantUML / drawio), images & galleries, files, video, audio, PDFs with
annotation, citations & footnotes (with DOI / PubMed lookup), and rich link
unfurls. Nested pages with emoji or custom icons and cover images, focus &
reader modes, and automatic version history.

### 🗂️ Organize with databases
Inline or full-page databases with **table, board (kanban), gallery, calendar,
timeline, and list** views. ~18 property types including select / multi-select,
date, person, file, URL — plus computed/linked types:

| Type | What it does |
|---|---|
| **Formula** | A computed cell from a safe expression (e.g. `budget * 2`, `if(done, "✓", "…")`) |
| **Relation** | Links rows to rows in another database (optionally bidirectional / mirrored) |
| **Rollup** | Aggregates a property across related rows (`count`/`sum`/`avg`/`min`/`max`/…) |

Reverse relations, row hierarchies (sub-items), row templates, a calculation
footer, and per-view filters, grouping, and multi-column sort.

### 🧠 Study (flashcards)
Turn knowledge into recall. Drop a **flashcard block** into any note, or manage
cards directly:

- **Spaced repetition (SM-2)** — grade each card Again / Hard / Good / Easy and
  Cairn schedules the next review automatically.
- **Decks** — nest, reparent, and merge decks, each with its own new-card and
  review limits.
- **Statistics** — retention rate, card-maturity buckets, a review heatmap,
  per-deck breakdown, and a 30-day forecast.
- **Leech detection** auto-suspends cards you keep failing; an optional daily
  **reminder email** nudges you when cards are due.
- **Export to Anki** (`.apkg`) or CSV — your study data is never locked in.

### 🤝 Collaborate
Live multi-cursor editing with presence (Yjs + Hocuspocus), block- and
range-anchored **comments**, **@mentions**, **track-changes suggestions** with a
diff drawer, page links + backlinks + transclusion, and a notification bell +
inbox.

### 🔎 Find anything
`⌘K` command palette with full-text + typo-tolerant trigram search, optional
**semantic / hybrid vector search** (a local embedding model ships in the image —
no external AI service required), search operators + saved searches, favorites,
a "see also" related-pages panel, and a sticky table-of-contents.

### 🌐 Share & export
Publish any page to an unlisted, read-only `/p/<slug>` link (no login,
`noindex`), or a multi-page public site at `/s/<slug>` — with optional password
and expiry. Export a whole workspace to a buildable **MkDocs** or **Docusaurus**
site, or per-page / subtree Markdown, HTML, DOCX, and PDF.

### 🔐 Stay secure & in control
Multi-tenant workspaces (owner / admin / editor / viewer), email+password or
**OAuth** login, **SSO** (OIDC / SAML / SCIM), **TOTP & WebAuthn MFA** with
step-up and an admin enforcement policy, optional **end-to-end page
encryption**, per-subtree page ACLs, spaces, page locks, trash with retention,
a workspace audit log, and encrypted backups.

### 🧰 Automate & integrate
A versioned **HTTP API** (`/api/v1`) with scoped API keys + Swagger UI, an
**MCP server** for AI assistants, **webhooks** with a delivery dashboard, a
no-code **automation rules** engine, and two-way **database connectors**
(Google Sheets, Airtable, CSV).

### 📱 Everywhere, for everyone
Responsive PWA with bounded offline (edits CRDT-merge on reconnect), quick
capture, light / dark / custom-accent themes, an onboarding wizard + template
gallery, keyboard shortcuts (`⌘/` cheatsheet), i18n (English / Spanish / Arabic
with RTL), and **WCAG 2.1 AA** accessibility enforced in CI.

> The full, version-by-version feature history lives in
> [CHANGELOG.md](CHANGELOG.md).

## Configuration

Only **three** variables are required; everything else is opt-in. `.env.example`
documents the full set (48+ keys).

| Variable | Required | Purpose |
|---|---|---|
| `DB_PASSWORD` | ✅ | Postgres password (interpolated into `DATABASE_URL` by compose) |
| `AUTH_SECRET` | ✅ | Session signing secret (≥ 32 chars; `openssl rand -base64 32`). **Both** `cairn` and `cairn-collab` must share the same value. |
| `PUBLIC_URL` | ✅ | Public base URL the browser uses (becomes `NEXTAUTH_URL`) |
| `CAIRN_VERSION` | — | Pin both images to a release (e.g. `0.10.2`); omit to track `latest` |
| `COLLAB_URL` | for collab | Browser-facing WebSocket URL of `cairn-collab` (`ws://localhost:1234`, or `wss://<domain>/collab` behind a proxy) |
| `CAIRN_MAX_UPLOAD_MB` | — | Per-file upload limit (default `25`) |
| `CAIRN_TRASH_RETENTION_DAYS` | — | Days before trash auto-purges (default `30`) |
| `CAIRN_LOG_LEVEL` | — | `debug` / `info` / `warn` / `error` (default `info`) |
| `FILE_BACKEND` | — | `local` (default) or `s3` (MinIO / AWS S3 — see the `s3` compose profile) |
| `AUTH_GOOGLE_ID` / `_SECRET`, `AUTH_GITHUB_ID` / `_SECRET` | — | OAuth login; a provider's button appears only when both halves are set |
| `SMTP_HOST` / `SMTP_FROM` / … | — | BYO-SMTP for email notifications, digests, and flashcard reminders |
| `CAIRN_METRICS_TOKEN` | — | Bearer token gating `/metrics` (Prometheus). `/metrics` is **off** until set |
| `CAIRN_NATIVE_PDF` | — | `1` enables real server-rendered PDF export (adds bundled Chromium) |
| `CAIRN_ENABLE_E2E_ENCRYPTION` | — | `true` surfaces the end-to-end page-encryption controls |

See [docs/operations.md](docs/operations.md) for the backups / reminders /
quotas / scheduler runbook (the in-process tickers are **single-instance only**;
prefer external cron otherwise).

### OAuth login (optional)

Google and GitHub sign-in are an **invite-gated** alternative to
email/password — a user can only sign in via OAuth if their verified email
already has a workspace membership or a matching unused invite. Register the
OAuth app with these callback URLs (`<PUBLIC_URL>` = your instance's base URL):

```
<PUBLIC_URL>/api/auth/callback/google
<PUBLIC_URL>/api/auth/callback/github
```

With neither pair set, Cairn shows only the email/password form — no dead
buttons.

## Operations

### Upgrades

Cairn auto-migrates the database at container start, so upgrading is just:

```sh
# Bump CAIRN_VERSION in .env to the new release, then:
docker compose pull
docker compose up -d
```

The app refuses to serve a half-migrated database (it fails the boot loudly
rather than running on a drifted schema). An in-app admin **upgrade** panel and
a release-watch notifier surface new versions when they're published.

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

`restore` is destructive and refuses to run unless you pass `--force` or confirm
the database name at the prompt. Backup bundles contain password & API-key
hashes and every uploaded file — **treat them as secrets** and copy them
off-host on a schedule. Set `CAIRN_BACKUP_ENCRYPTION_PASSPHRASE` to AES-256-GCM
encrypt the archives. On the S3/MinIO backend, `backup` dumps the database only —
back up the bucket out-of-band. Full details and the `pg_dump`/`pg_restore`
version pin are in [docs/operations.md](docs/operations.md).

### Troubleshooting: collaboration won't connect

Real-time editing runs in the separate `cairn-collab` service. The app mints a
short-lived, HMAC-signed token; `cairn-collab` verifies it. **Both services sign
and verify with the same `AUTH_SECRET`** — there is no separate collab secret. If
the two containers have different `AUTH_SECRET` values, every connection is
rejected and the editor silently falls back to local-only edits. Also note the
browser connects **directly** to `COLLAB_URL`, so that hostname must resolve from
the end-user's network (not just inside Docker). `cairn-collab` logs the reason
on each rejection (`reason=bad-sig` / `expired` / `page-mismatch`); check
`docker compose logs cairn-collab`. Full guide in
[docs/deployment.md](docs/deployment.md).

## HTTP API (v1)

A read/write JSON API under `/api/v1` for pages, databases, and rows. Create
keys under **Settings → API keys** (admin only); the full token (`cairn_sk_…`)
is shown once at creation. Send it as a bearer token:

```
Authorization: Bearer cairn_sk_<64-hex>
```

A key carries a workspace + role and acts on behalf of its creator; all role and
workspace checks apply, and ids from another workspace return `404`. Responses
are cursor-paginated and rate-limited per key. An interactive **OpenAPI /
Swagger UI** is served at `/api-docs`, with the raw spec at `/openapi.json`. For
AI assistants, an **MCP server** (Streamable HTTP + SSE, OAuth-secured) exposes
the same operations.

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

Cairn targets **WCAG 2.1 Level AA**. An `@axe-core/playwright` gate audits the
editor, sidebar, database views, dialogs, and sign-in on both light and dark
themes, and runs in CI as a dedicated job that fails the build on any AA
violation. The manual screen-reader checklist is at
[docs/a11y-screen-reader-checklist.md](docs/a11y-screen-reader-checklist.md).

## Local development

`pnpm dev` / `build` / `test` read the same `.env` directly, so it must contain
the full set from `.env.example` (not just the compose shorthand). Cairn uses
**pnpm**, **Node 24**, and Docker (for Testcontainers in the test suite).

```sh
cp .env.example .env
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # vitest (needs Docker for Testcontainers)
pnpm lint         # Biome
pnpm typecheck    # tsc
pnpm build        # Next.js standalone + entrypoint compile
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md) for the
architecture and conventions.

## License

MIT — see [LICENSE](LICENSE). Built from scratch, not derived from any other
Notion alternative.
