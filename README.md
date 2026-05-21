# Cairn

[![CI](https://github.com/jonathanmcohen/cairn/actions/workflows/ci.yml/badge.svg)](https://github.com/jonathanmcohen/cairn/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/jonathanmcohen/cairn)](https://github.com/jonathanmcohen/cairn/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Self-hosted, Notion-style block-based notes for homelab deployment.**

Cairn is a single-container web app you can run on your own hardware. It gives
you a familiar block-editor experience for nested notes, plus inline
databases, full-text search, and file uploads — without sending your content
to anyone else.

## Features

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
docker pull ghcr.io/jonathanmcohen/cairn:0.1.0
```

Then point your docker-compose at the published image instead of `build: .`:

```yaml
services:
  app:
    image: ghcr.io/jonathanmcohen/cairn:0.1.0
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
ghcr.io/jonathanmcohen/cairn:0.3.0          # the Next.js app
ghcr.io/jonathanmcohen/cairn-collab:0.3.0   # the collab (Hocuspocus) server
```

Public/read-only `/p/<slug>` pages do not use the collab socket and have no
presence or comments.

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
pnpm test              # 441 tests, requires Docker for testcontainers
pnpm lint              # Biome
pnpm typecheck         # tsc
pnpm build             # Next.js standalone + entrypoint compile
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

v0.1.0 is the initial release. Planned for later versions:

- **v0.3.x:** owner-transfer and workspace deletion; comment-reply threads
- **v0.4.x:** reverse / bidirectional relations; filter & sort on computed
  (formula/rollup) values
- **v0.4.x+:** native mobile apps, public API + webhooks, templates,
  page version history, S3/MinIO backend, backup/restore CLI

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure process.

## License

MIT — see [LICENSE](LICENSE). Built from scratch, not derived from any other
Notion alternative.
