# Cairn

[![CI](https://github.com/jonathanmcohen/cairn/actions/workflows/ci.yml/badge.svg)](https://github.com/jonathanmcohen/cairn/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/jonathanmcohen/cairn)](https://github.com/jonathanmcohen/cairn/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Self-hosted, Notion-style block-based notes for homelab deployment.**

Cairn is a single-container web app you can run on your own hardware. It gives
you a familiar block-editor experience for nested notes, plus inline
databases, full-text search, and file uploads — without sending your content
to anyone else.

## Features (v0.1.0)

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
- 📎 **File and image uploads** (HMAC-signed URLs, local-disk by default)
- ⬇️⬆️ **Markdown import/export** per page and per subtree (`.zip`)
- 👥 **Multi-tenant workspaces** with email/password auth and invite-token
  onboarding; owner / admin / editor / viewer roles
- 🌓 Light / dark / system theme

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
pnpm test              # 200+ tests, requires Docker for testcontainers
pnpm lint              # Biome
pnpm typecheck         # tsc
pnpm build             # Next.js standalone + entrypoint compile
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

v0.1.0 is the initial release. Planned for later versions:

- **v0.2.x:** real-time collaborative editing (Yjs), OAuth providers, public
  read-only sharing, comments + mentions, multi-workspace switching
- **v0.3.x+:** native mobile apps, public API + webhooks, templates,
  page version history, S3/MinIO backend, backup/restore CLI

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure process.

## License

MIT — see [LICENSE](LICENSE). Built from scratch, not derived from any other
Notion alternative.
