# Cairn

[![CI](https://github.com/jonathanmcohen/cairn/actions/workflows/ci.yml/badge.svg)](https://github.com/jonathanmcohen/cairn/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/jonathanmcohen/cairn)](https://github.com/jonathanmcohen/cairn/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Self-hosted, Notion-style block-based notes for homelab deployment.**

Cairn is a small, multi-container web app you run on your own hardware. By
v0.6.0 it covers a Notion-shaped surface — nested pages, inline databases
with reverse relations and rollups, real-time collaboration with comments
and track-changes suggestions, per-page public sharing and a multi-page
public site, a responsive PWA with bounded offline, WCAG 2.1 AA, TOTP 2FA,
audit log + observability, per-workspace storage quotas, scheduled backups,
import/export, search-filter + saved searches, reminders, and bulk page ops
— without sending your content to anyone else.

## v0.8.0 features

**PWA + mobile polish (G1).** Full Yjs-over-IndexedDB sync: every page the
user opens is mirrored to IndexedDB for the workspace session; offline edits
land in the local Yjs doc and CRDT-merge with the server on reconnect via the
existing Hocuspocus provider. FIFO eviction at `CAIRN_OFFLINE_DOC_LIMIT_MB`
(default 256MB). Mobile gesture polish: swipe-back on detail pages,
long-press → context menu on db rows + sidebar pages, pull-to-refresh on
list/timeline views. WCAG 2.5.5 touch-target audit across v0.7 surfaces.

**Performance pass (G2).** Virtualized page-tree sidebar +
virtualized db-table view (both via `@tanstack/react-virtual`) sustain 10k+
row workspaces. Code-split heavy editor extensions (TipTap math, syncedBlock,
embeds) cut the initial editor bundle by ≥ 200 KB. DB query audit covers the
top 5 routes by p99 latency; Lighthouse CI budget on `/p/<id>` (`@lhci/cli`)
fails the build if performance score drops > 5 points or LCP/FCP/TTI
regress > 10%.

**Quick capture + onboarding (G3).** In-tab hotkey `Cmd+Shift+N` /
`Ctrl+Shift+N` opens an "Add to inbox" modal from anywhere. PWA
`share_target` manifest entry registers Cairn as an OS-level share
destination (Chromium PWA-only; Firefox/Safari do not support `share_target`
as of v0.8.0). `POST /api/inbox` captures the payload as a child of the
workspace's lazily-created inbox page (`workspaces.inbox_page_id`). First-run
onboarding seeds a workspace from a bundled `welcome.zip` template (4 sample
pages + 1 sample database) on opt-in.

**Command palette + settings hub (G4).** Expanded cmdk action set: open
settings, switch workspace, create page, create database row, open recent
(× 10), search across workspace (FTS+semantic), MCP token info. Recent
commands surface above search results (localStorage-backed). Settings hub
restructured under a sidebar-nav layout (Account / Workspace / Admin /
Developer / Notifications / Security) with redirects from the old flat
paths. Microcopy + empty-state polish across every feature surface.

**A11y v0.7 new-route sweep (G5).** `pnpm test:a11y` Playwright + axe suite
extended to cover `/settings/developer`, `/settings/automation`,
`/settings/connectors`, `/settings/admin/webhooks/[id]/deliveries`, and
`/healthz`. Keyboard nav + focus management asserted on the mint-PAT
dialog, automation-rule form, and connector OAuth flow.

**Notification center + favorites + backlinks delta (G6).** Global-header
`<NotificationBell>` with unread badge + right-side `<NotificationDrawer>`
(focus-trapped, grouped today/this-week/older, per-row deep link, mark
read, see-all link). Full `/notifications` inbox page with filters
(type / date / status) and keyset pagination — shared list query with the
drawer. Favorites: drag-to-reorder via `@dnd-kit/sortable`
(migration `0030` adds `favorites.position`) plus arrow-key + Enter
keyboard nav. Backlinks delta: inline transclusion preview popover on
`[[page-link]]` hovers + unlinked-mentions sidebar section (FTS across
the workspace, deduped against existing linked references).

**Themes + page covers + icons (G7).** Per-user theme prefs
(migration `0032`: `user_theme_prefs` table) — accent color (8 presets +
custom hex), font family (system / serif / mono), page width
(narrow / wide / full). Applied via CSS custom properties on
`<html data-accent="...">` — Tailwind v4 `@theme` tokens inherit. Page
covers (migration `0033`: `pages.cover jsonb`): solid color (16 presets),
Unsplash (gated behind `CAIRN_UNSPLASH_ACCESS_KEY`, client-side search),
upload (reuses file-upload path). Page-icon polish: emoji-picker search +
recently-used row, custom-upload icon path, default-icon randomizer for new
pages.

**Embeds + new blocks (G8).** Embed allowlist expansion — Loom, Codepen,
Spotify, Vimeo Showcase, Mermaid (lazy-loaded `mermaid.js`), Excalidraw
(iframe to `excalidraw.com/embed?...`). CSP `frame-src` updated; drift-test
guards against accidental allowlist removal. Richer link unfurls extract
OpenGraph image + description from the existing v0.6 `/api/unfurl` (256KB
image fetch cap; SSRF guard inherited). New block types: `divider`,
`button` (CTA with optional URL action), `video` (uploaded MP4/WebM via
the existing file-upload path).

**Native PDF (G9).** Server-side native PDF export gated behind
`CAIRN_NATIVE_PDF=1`. Promotes `@playwright/test` to a runtime dep; a
singleton headless-Chromium browser per process renders the existing
`pageToPdfHtml(page)` to real `application/pdf` bytes. Browser-print HTML
remains the default; `?format=pdf-print-html` is an explicit fallback
selector. MCP `pages.export` tool surfaces the same path with base64-encoded
PDF bytes inside the JSON-RPC resource envelope.

**Release (G10).** Combined cross-feature smoke
(`scripts/smoke-v0.8.0.sh`) exercises every v0.8 delta band against a live
boot. README + SECURITY.md + CHANGELOG v0.8.0 promote; image published to
`ghcr.io/jonathanmcohen/cairn:0.8.0`.

## v0.7.0 features

**Authz primitives.** Per-user **Personal Access Tokens** (`cairn_pat_*`)
coexist with v0.5 workspace API keys; PATs carry a closed-vocab scope set
(`pages:read`, `mcp:write`, etc.) and a per-token **MCP tool allowlist**. Page
ACLs override workspace role per subtree (owner role bypasses the chain
entirely for recovery). A `/settings/developer` page lets users mint/revoke
PATs, view a per-token usage timeline, and copy a Claude Desktop / Cursor
config snippet.

**MCP server.** Streamable HTTP at `POST /api/mcp` plus an SSE fallback shim
at `GET /api/mcp/sse` + `POST /api/mcp/messages` for first-generation clients.
~20 tools cover pages / databases / rows / search / comments / files / workspace.
Tool dispatch enforces (scope ∈ PAT) ∧ (tool ∈ PAT allowlist) ∧
(user role + page ACL permits the underlying mutation).

**Observability + ops delta.** Always-open `GET /healthz` (K8s liveness probe);
`/metrics` still token-gated (unchanged from v0.6 P20) with new closed-label
series for `mcp_tool_called_total`, `embedding_generation_total`,
`automation_rule_fired_total`, and `connector_sync_total`. A per-webhook
delivery dashboard with manual replay + HMAC-secret rotate.

**Vector / semantic search.** pgvector + a bundled `all-MiniLM-L6-v2` ONNX
local embedding model (no external network needed); `CAIRN_EMBEDDING_URL` env
override for any OpenAI-compatible endpoint (Ollama, OpenAI, vLLM…). On-write
fire-and-forget embedding pipeline + a `pnpm cli reindex-embeddings` backfill.
`/api/search?mode=semantic` and `?mode=hybrid` (RRF) join the existing FTS path.

**Bulk import/export + scheduled S3 backup.** Workspace-settings UI for bulk
imports (Notion / Markdown folder / workspace archive) over the v0.6 P21 lib,
with SSE progress streaming. A `cron_schedules` table + an entrypoint scheduler
exec the existing backup CLI on a schedule; `pnpm cli restore --from-s3` closes
the v0.5/v0.6 gap where backups went to S3 but restore wanted a local file.

**Automation / rules engine.** Settings-page form builder: trigger event
(`row.created`, `page.updated`, …) → condition (the v0.6 filter operator vocab)
→ action (`notify`, `send_webhook`, `set_property`, `create_page`). Rules
persist as DB rows + fire fire-and-forget off the same internal event bus the
webhook dispatcher reads from.

**Two-way DB connectors.** A `ConnectorAdapter` interface + sync engine with
LWW per-cell conflict resolution and a conflict-review inbox. Three concrete
adapters: **Google Sheets** (OAuth + Drive change webhooks + Sheets API),
**Airtable** (paste-PAT + Airtable webhooks + Records API), **CSV** (file path
under `CAIRN_CONNECTOR_CSV_PATH`, poll-only).

## v0.6.0 features

The v0.6.0 surface in five bands (see [CHANGELOG.md](CHANGELOG.md) for the
full list):

- **Content & databases** — reverse/bidirectional relations, list view,
  filters + grouping + multi-sort, row hierarchy (sub-items), toggle /
  columns / table blocks, embed / bookmark / math / synced blocks,
  table-of-contents + outline + full-page DB view + calc footer.
- **Sharing & collaboration** — per-page share settings (password + expiry
  + duplicate), public multi-page site at `/s/<slug>`, comments on
  databases + files, Yjs suggestion / track-changes mode, page links +
  backlinks + page mentions/embeds + row templates, BYO-SMTP email
  notifications with digest mode and per-event preferences.
- **Mobile / a11y / i18n** — responsive mobile UI with off-canvas drawer,
  PWA + bounded offline (`y-indexeddb`), WCAG 2.1 AA + axe CI gate,
  keyboard-shortcuts registry + ⌘/ sheet, en + ar (RTL) i18n proof.
- **Admin, observability & ops** — favorites/recents + column ergonomics +
  block convert + multi-select, workspace admin console, audit log +
  per-page activity feed, TOTP 2FA + recovery codes, Prometheus metrics
  (`prom-client`) + structured logging (`pino`).
- **Quotas, import/export, search, bulk** — per-workspace storage quotas
  + `reconcile` CLI, scheduled-backup flags (`--retention-days`,
  `--target s3`), re-importable workspace export archive (secrets
  excluded), Notion + Markdown-folder + workspace-archive import with
  templates id-rewrite + import report, PDF export (browser-print) +
  per-page/per-database UI export buttons, search-filter compiler (author
  + date range) + per-user saved searches + sidebar list + palette
  section, due-date reminders + `reminders:scan` CLI, bulk trash / restore
  / move pages with partial-failure report, workspace-home landing.

## Features (carry-over from v0.1–v0.5)

- 🌳 **Nested pages** with sidebar tree, emoji icons, cover images
- ✍️ **Block editor** (paragraph, headings, lists, todo lists, blockquote,
  code with syntax highlight, callouts, divider, image, file)
- 🪄 **Slash menu** (`/`) to insert blocks; floating drag handle for
  per-block actions
- 💾 **Autosave** with optimistic UI and stale-write conflict detection
- 🔎 **⌘K command palette** with full-text + trigram (typo-tolerant) search
- 🗑️ **Trash bin** with 30-day auto-purge
- 🗂️ **Inline databases** with table, kanban, and gallery views; AND filters
  + multi-column sort
- 🧮 **Formula properties** — computed columns from a small, safe expression
  language (arithmetic, comparisons, `if`, `concat`, `round`/`min`/`max`/`sum`,
  date helpers); evaluated fresh on every read, never stored
- 🔗 **Relations** — link rows to rows in another database in the same workspace
- ➕ **Rollups** — aggregate a property across related rows
  (`count`/`sum`/`avg`/`min`/`max`/`earliest`/`latest`)
- 📅 **Calendar & timeline views** — place rows on a month grid or a horizontal
  time axis by a date property
- 📎 **File and image uploads** (HMAC-signed URLs, local-disk by default)
- ⬇️⬆️ **Markdown import/export** per page and per subtree (`.zip`)
- 👥 **Multi-tenant workspaces** with email/password auth and invite-token
  onboarding; owner / admin / editor / viewer roles
- 🔐 **OAuth login** (Google + GitHub) as an invite-gated alternate front door,
  linked to existing accounts by verified email — enabled per provider via env
- 🪟 **Multiple workspaces** — belong to and switch between workspaces on one
  instance; create, switch, accept invites as a logged-in user, and leave
- 🌐 **Public page sharing** — publish any page to an unlisted, read-only
  `/p/<slug>` link (anonymous, `noindex`), including embedded images and
  read-only databases
- 👥 **Real-time collaboration** — multiple people edit the same page live (Yjs/Hocuspocus), with remote cursors and presence
- 💬 **Comments & @mentions** — block/range-anchored comment threads, resolve/reopen, @mention workspace members
- 🔔 **Notifications** — a polled feed + unread bell, triggered by mentions and comment replies
- 🌓 Light / dark / system theme

### Database property types & views

Inline databases support text, number, select, multi-select, checkbox, date, and
URL properties, plus three **computed/linked** types added in v0.4.0:

| Type | What it does | Config |
|---|---|---|
| **Formula** | A computed cell from an expression (e.g. `budget * 2`, `if(done, "✓", "…")`). | `{ expression }` |
| **Relation** | Links to rows in another database **in the same workspace**. | `{ targetDatabaseId }` |
| **Rollup** | Aggregates a property over a relation. | `{ relationPropertyId, targetPropertyId, fn }` |

Views: **table**, **kanban**, **gallery**, and the v0.4.0 additions **calendar**
(month grid) and **timeline** (horizontal time axis). Calendar and timeline each
require a date property to place rows on.

> **⚠️ Known limitations (v0.4.0)**
> - **Formula and rollup values cannot be filtered or sorted.** They are computed
>   in JS *after* the SQL fetch (always fresh, never stored), so the database
>   filter/sort — which compiles to SQL — cannot see them. Computed columns
>   **display only**. Filter and sort on stored properties (text, number, date,
>   select, etc.) as usual.
> - **Reverse / bidirectional relations are not yet supported.** A relation is
>   single-direction: the target rows do not automatically gain a back-reference
>   property. (Planned for a v0.4.x follow-up.)
> - Relations cannot cross workspaces; a relation may only target a database in
>   the same workspace.

## Quickstart (Docker)

```sh
git clone https://github.com/jonathanmcohen/cairn.git
cd cairn
cp .env.example .env
# Edit .env — at minimum set DB_PASSWORD and AUTH_SECRET to your own values.
docker compose up -d
```

Visit `http://localhost:3000`. The first user to sign up becomes the
workspace owner.

### Pulling a published image

```sh
docker pull ghcr.io/jonathanmcohen/cairn:0.6.0
docker pull ghcr.io/jonathanmcohen/cairn-collab:0.6.0
```

Then point your docker-compose at the published images instead of `build: .`:

```yaml
services:
  app:
    image: ghcr.io/jonathanmcohen/cairn:0.6.0
  collab:
    image: ghcr.io/jonathanmcohen/cairn-collab:0.6.0
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | _required_ | Postgres connection string |
| `AUTH_SECRET` | _required_ | Session signing secret (≥ 32 chars) |
| `NEXTAUTH_URL` | _required_ | Public base URL |
| `CAIRN_MAX_UPLOAD_MB` | `25` | Per-file upload size limit |
| `CAIRN_TRASH_RETENTION_DAYS` | `30` | Days before trash auto-purges |
| `CAIRN_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `CAIRN_METRICS_TOKEN` | _unset_ | Bearer token gating `/metrics` (≥ 16 chars). `/metrics` is **OFF** until set. |
| `CAIRN_BACKUP_INTERVAL` | _unset_ | Opt-in in-process backup ticker (e.g. `24h`). OFF + single-instance only. |
| `CAIRN_REMINDER_INTERVAL` | _unset_ | Opt-in in-process `reminders:scan` ticker. OFF + single-instance only. |
| `CAIRN_DIGEST_INTERVAL` | `0` | Opt-in in-process email-digest ticker (minutes). `0` = off, single-instance only. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` | _unset_ | BYO-SMTP for email notifications + digests. Email is OFF until host + from are set. |

See [docs/operations.md](docs/operations.md) for the scheduled-backups /
reminders / quotas runbook and the external-cron pattern.

### OAuth setup (optional)

Cairn supports Google and GitHub sign-in as an **invite-gated** alternative to
email/password — a user can only sign in via OAuth if their verified email
already has a workspace membership or a matching unused invite. A provider's
button appears only when both of its env vars are set:

| Variable | Provider |
|---|---|
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub |

Register the OAuth app with these **callback (redirect) URLs**, where
`<PUBLIC_URL>` is your instance's public base URL:

```
<PUBLIC_URL>/api/auth/callback/google
<PUBLIC_URL>/api/auth/callback/github
```

- Google: https://console.cloud.google.com/apis/credentials
- GitHub: https://github.com/settings/developers

Set the matching env vars in `.env` (see `.env.example`). With neither pair
set, Cairn shows only the email/password form — no dead buttons.

### Sharing

Any page can be **published to the web** from its overflow menu. Publishing
mints a stable, unguessable `/p/<slug>` URL that renders the page **read-only**
to anyone with the link — no login required. Published pages are **unlisted**
(`<meta name="robots" content="noindex">`) and link-only; embedded images and
inline databases render read-only. Unpublishing makes the link return 404
(the slug is retained, so re-publishing reuses the same URL).

### Collaboration setup

Real-time editing runs in a second container, **`cairn-collab`** (a Hocuspocus
Yjs server sharing the same Postgres). A homelab deploy now runs **three**
containers: `cairn`, `cairn-collab`, and `db` — all wired in `docker-compose.yml`.

The browser connects to the collab server via `COLLAB_URL` (the public WS URL of
the `cairn-collab` service; set it in `.env`). Images:

```
ghcr.io/jonathanmcohen/cairn:0.6.0          # the Next.js app
ghcr.io/jonathanmcohen/cairn-collab:0.6.0   # the collab (Hocuspocus) server
```

Public/read-only `/p/<slug>` pages and the multi-page public site at
`/s/<slug>` do not use the collab socket and have no presence or comments.

## Operations

### Backup & restore

Cairn ships a backup CLI built into the same image as the server. It dumps the
Postgres database (custom format) and, on the local file backend, archives the
uploads tree into a timestamped bundle.

```sh
# Back up the database + uploads into a directory:
docker compose exec cairn node dist/server/cli.js backup --out /data/backups

# Restore from a bundle (DESTRUCTIVE — overwrites the current DB + uploads):
docker compose exec cairn node dist/server/cli.js restore --in /data/backups/cairn-backup-<ts>.dump
```

`backup` writes three files per run: `cairn-backup-<ts>.dump` (the database),
`cairn-uploads-<ts>.tar.gz` (the local uploads tree), and
`cairn-backup-<ts>.manifest.json`. Mount a host volume at the `--out` path and
copy the bundle off-host on a schedule (cron the `backup` command); Cairn does
not ship an off-host scheduler.

`restore` is **destructive** — it drops and recreates objects before importing.
It refuses to run unless you either pass `--force` or type the database name at
the interactive confirmation prompt. Never wire `restore --force` into an
unattended path you don't fully trust.

**Postgres client version:** the CLI shells out to `pg_dump`/`pg_restore` from
the `postgresql-client-16` package baked into the image. These must match the
server's **major** version (Postgres 16); a client older than the server cannot
restore a custom-format dump. If you upgrade Postgres, upgrade the client pin in
the Dockerfile in lockstep.

**S3/MinIO file backend:** when `FILE_BACKEND=s3`, files live in the bucket, so
`backup` dumps the **database only** and prints a reminder — back up your S3/MinIO
bucket out-of-band (bucket versioning or your provider's snapshot/replication).

> **Warning — bundles are sensitive.** A backup bundle contains the full database,
> including bcrypt **password hashes** and SHA-256 **API-key hashes**, plus every
> uploaded file. Treat bundles as secrets: encrypt them at rest and restrict who
> can read the backup directory. The CLI never transmits bundles anywhere.

### Static-site export

Cairn can emit a buildable [MkDocs](https://www.mkdocs.org/) project from any
workspace — every page becomes a Markdown file under `docs/`, every referenced
image/file is bundled into `docs/assets/`, and a `mkdocs.yml` with the Material
theme + nav tree is generated.

The pipeline is exposed two ways:

```sh
# CLI — emit a ZIP to disk:
pnpm export:static -- --workspace <workspace-uuid> --target mkdocs --out cairn-site.zip
unzip cairn-site.zip -d ./cairn-site && cd ./cairn-site && mkdocs serve

# Admin UI: Settings → Workspace → Static-site export → "Generate".
# The browser downloads the same ZIP via POST /api/exports/static-site.
```

Workspaces containing any encrypted page (E2E per-page or workspace-wide mode)
are **refused** — static export is public-share-equivalent and must not leak
ciphertext. Only `mkdocs` is wired in v0.9.0; the Docusaurus target lands in
P35 with no API/UI breakage.

## Local development

For `pnpm dev`, `pnpm build`, or `pnpm test` run outside the container, the
same `.env` file is consumed directly by Next.js — so it must contain the full
set of variables defined in `.env.example`, not just the docker-compose subset.
The `DB_PASSWORD` / `PUBLIC_URL` shorthand keys are only read by
`docker-compose.yml` to interpolate the full URLs; `pnpm` commands need the
full `DATABASE_URL` and `NEXTAUTH_URL` directly.

```sh
cp .env.example .env   # full set; both compose AND pnpm read from here
pnpm install
pnpm dev               # http://localhost:3000
pnpm test              # 1129 passing, requires Docker for testcontainers
pnpm lint              # Biome
pnpm typecheck         # tsc
pnpm build             # Next.js standalone + entrypoint compile
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## HTTP API (v0)

Cairn exposes a read/write JSON API under `/api/v1` for pages, databases, and
database rows. Authenticate every request with a workspace API key.

### Authentication

Create keys under **Settings → API keys** (admin only). The full token
(`cairn_sk_…`) is shown **once** at creation — only its prefix is stored, so
copy it immediately. Send it as a bearer token:

```
Authorization: Bearer cairn_sk_<64-hex>
```

A key carries a workspace and a role (`admin`/`editor`/`viewer`) and acts on
behalf of the user who created it. All existing role and workspace checks
(`requireRole`, `requirePageAccess`) apply unchanged; ids from another
workspace return `404` (never `403`, to avoid leaking existence). Optional
expiry rejects the key after its `expires_at`.

### Errors

Every error shares a single shape:

```json
{ "error": { "code": "not_found", "message": "..." } }
```

Codes: `unauthorized` (401), `forbidden` (403), `not_found` (404),
`validation` (400), `rate_limited` (429), `internal` (500).

### Pagination

List endpoints are cursor-paginated:

```
GET /api/v1/pages?limit=50&cursor=<opaque>
```

`limit` defaults to 25, max 100. The response envelope is
`{ "data": [...], "nextCursor": "<opaque>|null" }`; pass `nextCursor` back as
`cursor` to fetch the next page. Cursors are opaque keyset tokens over
`(createdAt, id)`.

### Rate limiting

Requests are rate-limited **per key** via an in-memory token bucket (~60-request
burst, ~1 req/s steady). The bucket lives in the process heap, so it is
**single-instance only** — it is not shared across replicas and resets on
restart. Exceeding it returns `429 rate_limited`.

### Endpoints

| Method   | Path                                            | Role   |
| -------- | ----------------------------------------------- | ------ |
| `GET`    | `/api/v1/pages`                                 | viewer |
| `POST`   | `/api/v1/pages`                                 | editor |
| `GET`    | `/api/v1/pages/{pageId}`                        | viewer |
| `PATCH`  | `/api/v1/pages/{pageId}`                        | editor |
| `DELETE` | `/api/v1/pages/{pageId}`                        | editor |
| `GET`    | `/api/v1/databases`                             | viewer |
| `POST`   | `/api/v1/databases`                             | editor |
| `GET`    | `/api/v1/databases/{databaseId}`                | viewer |
| `PATCH`  | `/api/v1/databases/{databaseId}`                | editor |
| `DELETE` | `/api/v1/databases/{databaseId}`                | editor |
| `GET`    | `/api/v1/databases/{databaseId}/rows`           | viewer |
| `POST`   | `/api/v1/databases/{databaseId}/rows`           | editor |
| `GET`    | `/api/v1/databases/{databaseId}/rows/{rowId}`   | viewer |
| `PATCH`  | `/api/v1/databases/{databaseId}/rows/{rowId}`   | editor |
| `DELETE` | `/api/v1/databases/{databaseId}/rows/{rowId}`   | editor |

A generated OpenAPI document is out of scope for this release.

## Roadmap

v0.6.0 closes the v0.1 → v0.6 plan (real-time collab, public site, mobile
PWA, a11y AA, 2FA, observability, quotas, scheduled backups, import/export,
saved searches, reminders, bulk page ops). Carried into v1.0 / later:

- **Filter & sort on computed (formula/rollup) values** — still display-only.
- **`totp:disable` CLI** for lockout recovery (admin out-of-band).
- **Distributed lock** for backup / reminder / digest tickers so they're
  safe on multi-instance deploys (today: external cron).
- **Native mobile apps**, **public API + webhooks**, **OpenAPI document**.

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## Security

Cairn ships secure-by-default: hardening response headers (a strict CSP plus
`nosniff`/frame-DENY/referrer/permissions-policy/HSTS, with a locked-down policy
for the public `/p/` path), in-process rate limiting on login/signup/collab-token
endpoints, and an adversarial security-regression suite (`tests/security/`) that
fails loudly on tenant-isolation, RBAC, file-URL, public-sharing, collab-token,
injection, XSS, or secret-leakage regressions. Supply-chain advisories
(`pnpm audit --audit-level=high`) and committed secrets (`gitleaks`) are gated in
CI. The `tests/security` suite runs in CI, and `scripts/smoke-security.sh` checks
the live docker stack (headers, CSP-renders-the-app, anon denial, forged tokens).

See [SECURITY.md](SECURITY.md) for the STRIDE-lite threat model, the
trust-boundary→control table, residual risks, and the vulnerability-reporting
process.

### v0.8.0 security & operations caveats (additions)

- **Playwright runtime surface (`CAIRN_NATIVE_PDF`).** As of v0.8.0,
  `@playwright/test` is a runtime dependency. The Chromium binary it bundles
  is large (~150MB image growth); the binary is downloaded only when
  `CAIRN_NATIVE_PDF=1` is set — the path is otherwise dormant. The PDF route
  holds a singleton `Browser` instance per process (lazy-launched on first
  PDF request; closed on `SIGTERM`/`SIGINT` for clean container exit). The
  MCP `pages.export` tool rejects `format=pdf` with `INVALID_REQUEST` when
  the env is unset rather than falling back silently to HTML.
- **Unsplash key handling (`CAIRN_UNSPLASH_ACCESS_KEY`).** Cover-picker
  Unsplash search is client-side; the key is added to `FORBIDDEN_KEYS`
  (secret-leak suite) and to `pino`'s redact list. The configuration API
  never returns the key. If the env is unset, the cover picker degrades to
  show only the color + upload tabs (no broken Unsplash UI).
- **Offline-doc IndexedDB cap (`CAIRN_OFFLINE_DOC_LIMIT_MB`,
  default 256MB).** Every page the user opens is mirrored to IndexedDB for
  the workspace session. FIFO eviction kicks in when the per-workspace total
  exceeds the cap (G1 P1). This is client-side state only — no new
  server-side secrets, no quota impact on the server. Operators who want
  larger offline windows raise the env; users who want smaller can do
  nothing (the cap is build-time-baked because `NEXT_PUBLIC_*` env vars are
  inlined at build time per Next 16 convention).
- **PWA `share_target` browser support gaps.** Chromium-based PWAs honor
  the manifest entry (Android share sheet, ChromeOS, Windows/macOS
  Chromium). Firefox and Safari do not implement `share_target` as of
  v0.8.0. The hotkey path (`Cmd+Shift+N`) covers every browser; documented
  in the onboarding wizard so users on unsupported browsers see a tip
  instead of broken expectations.
- **CSP `frame-src` additions (G8 P22).** The embed allowlist now includes
  Loom, Codepen, Spotify, Vimeo Showcase, Mermaid (data-URL), and
  Excalidraw. Each provider's domain is added to the route-level CSP
  `frame-src` directive and asserted by the drift test
  (`tests/lib/security/embed-allowlist.test.ts`) so accidental removal
  fails the build.
- **Single-instance ceiling — unchanged.** v0.8 does not add any new
  in-process schedulers; the ceiling documented in v0.6 / v0.7
  (backup/reminders/digest tickers + cron_schedules + automation
  event-subscriber + connector sync orchestrator) is the full set.

### v0.7.0 security & operations caveats (additions)

- **PATs are per-user, scoped, and a separate token class.** PAT secrets are
  prefixed `cairn_pat_` and stored only as a SHA-256 hash; the plaintext is
  shown once at mint and never echoed. PATs carry an explicit scope list
  (`pages:read`, `mcp:write`, …) and — for MCP tools — a per-token tool
  allowlist. Empty allowlist = no MCP access regardless of scope. Tool
  dispatch always falls through to the acting user's workspace role + page
  ACL; a PAT can never escalate beyond the minting user.
- **Page ACL precedence.** Effective permission = nearest ancestor ACL else
  the user's workspace role; **owner role bypasses the ACL chain** for
  recovery + ownership guarantee. Public-share (`/p/<slug>`) is a separate
  axis — anonymous-only; logged-in members always route through the
  role+ACL resolver.
- **MCP tool allowlist + write safety.** Tool dispatch requires (scope ∈ PAT)
  ∧ (tool ID ∈ PAT.mcp_tools) ∧ (the underlying mutation passes the user's
  role + page ACL check). Named presets ("read-only", "full CRUD",
  "write-minus-destructive", "MCP read-only", "MCP full") cover the common
  cases; advanced multi-select for power users. There are no per-call
  agent-confirmation prompts (UX-fragile across MCP clients).
- **Connector OAuth refresh tokens + Airtable PAT + webhook MAC secret.**
  All connector auth material is encrypted at rest in
  `database_connectors.auth_config` via the v0.6 secret-box (AES-256-GCM, key
  derived from `AUTH_SECRET` via HKDF). Plaintext is decrypted only inside the
  sync engine; never echoed in any API response, audit metadata, token-usage
  log, or workspace-archive export (asserted by the extended secret-leak
  suite in P22).
- **Embedding API key (BYO mode).** If `CAIRN_EMBEDDING_URL` +
  `CAIRN_EMBEDDING_API_KEY` are configured, the key is in `pino`'s redact list
  and never appears in logs / API responses / the workspace export. The
  default bundled local model (`all-MiniLM-L6-v2`) has no API key.
- **Single-instance ceiling — three new schedulers.** Cairn still has no
  distributed lock; the new `cron_schedules` ticker (G5), the automation
  event-subscriber loop (G6), and the connector sync orchestrator (G7) all
  inherit the v0.6 P21 single-instance ceiling. Multiple instances will
  double-fire all three. Documented alongside the v0.6 backup/reminders/digest
  tickers in `docs/operations.md`.

### v0.6.0 security & operations caveats

- **Metrics endpoint (`/metrics`) is OFF by default.** It binds only when
  `CAIRN_METRICS_TOKEN` is set, and requires a matching `Authorization:
  Bearer <token>` on every scrape. Labels are aggregate-only — no tenant /
  workspace / user ids are exported.
- **TOTP 2FA secrets are encrypted at rest** (AES-256-GCM, key derived from
  `AUTH_SECRET`); recovery codes are stored hashed and are single-use.
  Lockout recovery (a `totp:disable` CLI subcommand) is deferred — handle
  lost-device cases out-of-band today.
- **Single-instance scheduling ceiling.** `CAIRN_BACKUP_INTERVAL`,
  `CAIRN_REMINDER_INTERVAL`, and `CAIRN_DIGEST_INTERVAL` are in-process
  tickers, **OFF by default and SINGLE-INSTANCE only** — two replicas
  double-fire. Prefer external cron invoking the CLI (`pnpm cli backup`,
  `pnpm cli reminders:scan`, `pnpm cli email:digest`) for multi-instance
  setups; there is no distributed lock in v1.0.
- **Anonymous public surfaces (`/p/`, `/s/`).** Password-protected pages
  use Argon2id + HMAC-signed cookies. The public site at `/s/<slug>` lists
  only pages explicitly published into it. The CSP `frame-src` allowlist
  is pinned to the embed providers below and is drift-guarded by a test.
- **Offline scope.** The PWA's `y-indexeddb` offline buffer is **bounded**
  (recent pages only) and resyncs on reconnect. It is not a full
  offline-first sync engine — don't expect parity with the server while
  disconnected for long stretches.
- **Embed allowlist.** Only YouTube, Vimeo, Figma, GitHub gist, and
  CodeSandbox iframes are accepted; all are sandboxed and HTTPS-only.
  Arbitrary `<iframe>` embeds are explicitly out of scope.

## Accessibility

Cairn targets **WCAG 2.1 Level AA** across the authenticated app surfaces.
Compliance is enforced by an `@axe-core/playwright` gate (`pnpm test:a11y`)
that audits the editor, sidebar, database table, share/page-actions dialog,
and sign-in screen on both **light and dark** themes. The same gate runs in
CI as a dedicated `a11y` job and fails the build on any WCAG 2.1 AA
violation, so a regression in semantic landmarks, ARIA usage, color contrast,
focus management, or labelled controls blocks the merge.

What axe cannot evaluate — screen-reader reading order, live-region
announcement quality, the keyboard-driven feel of menus and grids — is
covered by a manual checklist at
[docs/a11y-screen-reader-checklist.md](docs/a11y-screen-reader-checklist.md).
Run that checklist before any release that touches the editor, sidebar,
database views, dialogs/popovers, or sign-in.

## License

MIT — see [LICENSE](LICENSE). Built from scratch, not derived from any other
Notion alternative.
