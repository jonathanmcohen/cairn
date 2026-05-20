# Cairn — v0.1.0 Design

**Status:** Approved (brainstorming complete)
**Date:** 2026-05-20
**Target release:** v0.1.0 (initial MVP)
**Repository:** `~/projects/cairn` (to be pushed to `github.com/<user>/cairn`)
**Container image:** `ghcr.io/<user>/cairn`

## 1. Purpose

Cairn is a self-hosted, Notion-style block-based notes application designed for homelab deployment. It is built from scratch (not a fork of an existing project) so the data model, deployment story, and feature set can be tuned to a small-team, single-instance topology.

The v0.1.0 milestone is an opinionated MVP: enough of Notion's core experience to be genuinely useful, with explicit deferral of large features (real-time collab, formulas, mobile apps) to later releases.

## 2. Scope

### In scope for v0.1.0

- Multi-tenant workspace model with email/password auth and invite-based onboarding
- Roles: `owner`, `admin`, `editor`, `viewer`
- TipTap-based block editor with paragraph, headings (H1–H3), bullet/numbered/todo lists, quote, callout, code (syntax-highlighted), divider, image, file attachment, and embedded-database blocks
- Slash-command block insertion menu; per-block drag handle (move/duplicate/delete)
- Nested pages with sidebar tree, page icons (emoji), and cover images
- Autosave (debounced ~800 ms)
- Global search (⌘K / Ctrl+K) over titles and flattened page text, using Postgres FTS + `pg_trgm` fuzzy fallback
- Inline databases with property types (text, number, single-select, multi-select, date, checkbox, URL), and three views: table, kanban, gallery — each with multi-column sort and AND-only filter
- File and image uploads to a local Docker volume, with configurable max size
- Markdown import (paste or upload) and export (per page or full subtree as a `.zip`)
- Soft-delete trash bin with 30-day auto-purge (configurable)
- Light/dark/system theme; responsive layout (sidebar collapses below 768 px)
- Single-container production image published to GitHub Container Registry on tagged releases (`v*.*.*`), multi-arch (`linux/amd64`, `linux/arm64`)

### Out of scope for v0.1.0 (deferred)

**v0.2.x candidates:**

- Multi-workspace switching from a single instance
- Real-time collaborative editing via Yjs + WebSocket (the editor schema is kept compatible)
- OAuth providers (Google, GitHub) via Auth.js
- Database formulas, relations, rollups
- Calendar and timeline database views
- Comments, @mentions, notifications
- Public read-only page sharing

**v0.3.x and beyond:**

- Native mobile apps (web stays responsive only)
- Public API and webhook system
- Templates gallery
- Page version history
- Block-level permissions
- S3/MinIO file backend (interface is pluggable; default stays local disk)
- Built-in backup/restore CLI

**Explicitly out of scope:**

- AI/LLM features
- Desktop (Electron) apps
- End-to-end encryption (rely on host disk encryption)

### Operational non-goals for v0.1.0

- High availability or multi-instance deployment (the supported topology is a single container)
- Horizontal scaling (autosave and trash purge logic assume a single process)
- Observability beyond `/api/health` and structured stdout logs

## 3. Architecture

### 3.1 Process model

A single Next.js Node process serves both UI and `/api/*` routes. Postgres 16 runs as a separate container. Connected by a private docker-compose network. Files persist on a host-mounted volume.

```
┌─────────────────────────────────────────────────────┐
│            docker-compose (homelab host)            │
│                                                     │
│  ┌───────────────────┐      ┌────────────────────┐  │
│  │  cairn (Next.js)  │◀────▶│  postgres:16-alpine│  │
│  │     port 3000     │      │     port 5432      │  │
│  └─────────┬─────────┘      └────────┬───────────┘  │
│            │                         │              │
│   /data/uploads (volume)    cairn_db (volume)       │
└─────────────────────────────────────────────────────┘
```

No Redis, message queue, or worker process in v0.1.0. Background jobs (trash purge) run opportunistically on incoming requests with a debounce.

### 3.2 Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node 22 LTS (alpine) | |
| Framework | Next.js 15 App Router, React 19, TypeScript strict | Single full-stack app |
| ORM | Drizzle | Migrations checked in, run on container startup |
| DB | Postgres 16 | `pg_trgm` extension for fuzzy search |
| Editor | TipTap 2 + lowlight for code highlighting | Yjs-compatible schema |
| Auth | Auth.js (NextAuth) | Credentials provider, DB sessions |
| Styling | Tailwind CSS + shadcn/ui | `darkMode: 'class'` |
| Data fetching | TanStack Query | Server actions where appropriate |
| Validation | Zod | Shared between client and server |
| Testing | Vitest (unit/integration), Playwright (smoke) | Postgres service container in CI |
| Linting | Biome | Replaces ESLint + Prettier |
| Package mgr | pnpm | |
| File storage | Local disk (`/data/uploads`) | Pluggable interface for future S3 |
| Search | Postgres FTS (`tsvector` + GIN) + `pg_trgm` | No external search service |

### 3.3 Data model

Core tables:

```text
workspaces          (id, name, slug, plan, created_at)
users               (id, email, password_hash, name, avatar_url, created_at)
workspace_members   (workspace_id, user_id, role, joined_at)
invite_tokens       (id, workspace_id, email, role, expires_at, used_at)

pages               (id, workspace_id, parent_id, title, icon, cover_url,
                     content jsonb,           -- ProseMirror/TipTap JSON
                     content_text text,       -- flattened plain text
                     content_tsv tsvector,    -- GIN-indexed; trigger-maintained
                     created_by, created_at, updated_at,
                     deleted_at,              -- soft-delete trash (null if live)
                     deleted_root boolean)    -- true if this page was the deletion target
                                              -- (vs. a cascaded descendant); used to
                                              -- correctly scope restores

databases           (id, workspace_id, page_id, name, created_by, created_at)
db_properties       (id, database_id, name, type, config jsonb, position)
db_rows             (id, database_id, created_by, created_at, updated_at, archived_at)
db_cells            (id, row_id, property_id, value jsonb)
db_views            (id, database_id, type, name, config jsonb)  -- sorts, filters, group_by

files               (id, workspace_id, page_id, name, mime_type, size, path,
                     uploaded_by, created_at)
sessions, accounts, verification_tokens   -- Auth.js managed
```

Key design choices:

- `pages.content` stores ProseMirror JSON; every block (paragraph, callout, embedded database reference, etc.) is a node in that tree. The schema is intentionally compatible with future Yjs integration.
- A Postgres trigger keeps `pages.content_text` and `pages.content_tsv` in sync on every insert/update — no manual reindex step.
- Inline databases use a four-table pattern (`databases`, `db_properties`, `db_rows`, `db_cells`, `db_views`). The page's `content` JSON contains a `database` node referencing `databases.id`.
- `pages.deleted_at` powers the trash bin. Auto-purge after 30 days (configurable via `CAIRN_TRASH_RETENTION_DAYS`).
- Files live on disk; the `files` table is the metadata index. The path layout is `/data/uploads/<workspace-id>/<uuid>.<ext>`.

### 3.4 Authentication & authorization

- Auth.js credentials provider with bcrypt password hashing (cost 12)
- Sessions stored in Postgres (`sessions` table), 30-day rolling expiry
- **Bootstrap flow:** the first user to sign up creates the workspace and is assigned `owner`
- All subsequent signups require an invite token (admin-generated, one-time, optionally email-bound, 7-day expiry)
- Role hierarchy: `owner > admin > editor > viewer`
  - `owner`: exactly one per workspace; can transfer to an admin
  - `admin`: manages invites, members, workspace settings
  - `editor`: creates, edits, deletes pages and databases
  - `viewer`: read-only access
- Authorization is enforced at the API route level via a `requireRole(role)` helper. Server components fetch via the same helpers — no client-trust paths.

### 3.5 Editor & block model

- TipTap v2 with a curated set of extensions:
  - StarterKit (paragraph, headings, lists, code blocks, blockquote, horizontal rule)
  - Task lists, Placeholder, CharacterCount
  - Custom: `callout` (4 colors), `image` (with upload integration), `file` (attachment), `database` (block referencing a `databases.id`)
  - Lowlight (Shiki at edit-time is too heavy; lowlight + highlight.js styles is the v0.1.0 choice)
- Slash menu: triggered by `/` at start of an empty block; filterable by block name
- Drag handle: floating left-margin handle revealed on hover; uses TipTap's `Selection` API
- Autosave: debounce 800 ms after the last edit; full `content` JSON is PUT to `/api/pages/:id`. Optimistic UI; on conflict (newer `updated_at` server-side), show a non-destructive toast and reload

### 3.6 Search

- Postgres FTS using `to_tsvector('english', title || ' ' || content_text)` stored as `pages.content_tsv`
- GIN index on `content_tsv`; B-tree on `workspace_id`
- Query path: `websearch_to_tsquery` for natural input, plus a `pg_trgm` similarity check on `title` for typo tolerance
- Results: title, snippet (`ts_headline`), breadcrumb (recursive CTE over `parent_id`)
- Scoped to the current workspace and the caller's role permissions

### 3.7 Databases

- Insert as a block via `/database` in the slash menu; the database is owned by the containing page (deleting the page archives the database)
- Property types in v0.1.0: `text`, `number`, `select`, `multi_select`, `date`, `checkbox`, `url`
- Views:
  - **Table**: rows × properties; click cell to edit inline
  - **Kanban**: requires a `select` property as the group_by; columns = options
  - **Gallery**: cards; optional cover from a `url` property
- Per-view config (stored as JSONB in `db_views.config`):
  - `sorts`: ordered list of `{property_id, direction}`
  - `filters`: AND-only list of `{property_id, operator, value}`
  - `group_by`: kanban only
  - `visible_properties`: ordered list
- Out of scope for v0.1.0: nested OR filter groups, formulas, relations, rollups, calendar, timeline, row-level permissions

### 3.8 Files & uploads

- POST `/api/upload` accepts multipart; validates mime type against an allowlist and size against `CAIRN_MAX_UPLOAD_MB` (default 25)
- Stores under `/data/uploads/<workspace-id>/<uuid>.<ext>`
- Returns a signed URL (HMAC, 1-hour expiry) for the editor to embed
- Read path: `/api/files/:id` re-validates the signature and streams from disk
- Pluggable backend: a `FileStorage` interface with `LocalDiskStorage` as the only v0.1.0 implementation; S3 is a future drop-in

### 3.9 Trash & soft delete

- Pages soft-deleted via `deleted_at`; their descendants are marked deleted in the same transaction
- Trash view in the sidebar shows top-level deleted pages from the workspace, sorted by `deleted_at desc`
- Restore: clears `deleted_at` on the page and on descendants whose deletion was part of the same cascade (i.e. their `deleted_root` is false and their nearest deleted ancestor is the restoring page)
- Auto-purge: throttled to at most once per hour per instance (coordinated via a Postgres advisory lock); deletes rows where `deleted_at < now() - retention`. Runs opportunistically on incoming requests — no separate worker process

### 3.10 Theming & UX

- Theme: light / dark / system, persisted in `localStorage`; `next-themes` package
- Keyboard shortcuts:
  - ⌘K / Ctrl+K — open search
  - ⌘N / Ctrl+N — new page (at root or child of current)
  - ⌘B / I / U — inline formatting
  - ⌘/ — open slash menu in the editor
  - Esc — close modals/menus
- Layout: persistent left sidebar at ≥ 768 px; collapses to a drawer on small screens
- Empty states for: empty workspace, empty page, no search results, empty trash

## 4. Deployment & operations

### 4.1 Dockerfile

Multi-stage build producing an image ~150 MB:

1. **`deps`** — `node:22-alpine`; `pnpm install --frozen-lockfile`
2. **`build`** — copy source; `pnpm build` with Next.js standalone output
3. **`runner`** — `node:22-alpine`; copy standalone bundle + static assets + drizzle migrations; non-root user `cairn:cairn` (uid 1001); expose 3000; `HEALTHCHECK` against `/api/health`

Container entrypoint runs `drizzle-kit migrate` then `node server.js`.

### 4.2 docker-compose.yml (default homelab setup)

```yaml
services:
  cairn:
    image: ghcr.io/<user>/cairn:0.1.0
    restart: unless-stopped
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://cairn:${DB_PASSWORD}@db:5432/cairn
      AUTH_SECRET: ${AUTH_SECRET}
      NEXTAUTH_URL: ${PUBLIC_URL}
      CAIRN_MAX_UPLOAD_MB: 25
      CAIRN_TRASH_RETENTION_DAYS: 30
    volumes:
      - cairn_uploads:/data/uploads
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: cairn
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: cairn
    volumes:
      - cairn_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cairn"]
      interval: 10s

volumes:
  cairn_uploads:
  cairn_db:
```

Ships with `.env.example` so the homelab operator edits only `.env` before `docker compose up -d`.

### 4.3 Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | Postgres connection string |
| `AUTH_SECRET` | — (required) | Auth.js session signing secret |
| `NEXTAUTH_URL` | — (required) | Public base URL for redirects |
| `CAIRN_MAX_UPLOAD_MB` | `25` | Per-file upload limit |
| `CAIRN_TRASH_RETENTION_DAYS` | `30` | Days before trash auto-purges |
| `CAIRN_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

### 4.4 CI/CD

Two GitHub Actions workflows:

**`.github/workflows/ci.yml`** — every PR, every push to `main`:

- Checkout, setup pnpm + Node 22, restore cache
- `pnpm install --frozen-lockfile`
- `pnpm lint`, `pnpm typecheck`
- `pnpm test` (Vitest) with a Postgres 16 service container
- `pnpm build` smoke-test

**`.github/workflows/release.yml`** — triggered on tags matching `v*.*.*`:

- `docker/setup-qemu-action` and `docker/setup-buildx-action`
- Login to `ghcr.io` using `${{ secrets.GITHUB_TOKEN }}`
- `docker/build-push-action@v6` with:
  - `platforms: linux/amd64,linux/arm64`
  - `tags: ghcr.io/<owner>/cairn:<version>`, `:<major>.<minor>`, `:<major>`, `:latest` (latest only when not prerelease)
  - `provenance: true`, `sbom: true`
- Create a GitHub Release with auto-generated notes from commits

### 4.5 Versioning & release flow

- Single source of truth: `package.json` `"version"`
- Version is exposed at `GET /api/health` and shown in the sidebar footer
- Release: bump `package.json`, update `CHANGELOG.md`, commit, tag `v<x.y.z>`, push — Actions does the rest
- Adheres to [Semantic Versioning 2.0.0](https://semver.org). v0.1.0 is the first tagged release
- Changelog follows [Keep a Changelog](https://keepachangelog.com)

### 4.6 Repository bootstrap

- License: MIT (`LICENSE`)
- `README.md` — quick-start docker-compose snippet, screenshots placeholder, env-var table
- `CONTRIBUTING.md` — minimal contributor guide
- `CHANGELOG.md` — starts with the v0.1.0 entry
- `.editorconfig`, `.gitignore`, `.dockerignore`, `.nvmrc` (node 22)

## 5. Testing strategy

- **Unit tests** (Vitest): pure logic (filter compilation, role checks, markdown converter, trash-purge query builder)
- **Integration tests** (Vitest + Postgres service container): API routes including auth, page CRUD, database CRUD, search, uploads
- **End-to-end smoke** (Playwright, optional in CI gate): signup → create page → add blocks → reload → search finds it
- Coverage target: 70% lines on the API layer; UI components are tested via integration where they have logic

## 6. Open questions for later releases (not blockers for v0.1.0)

- Should v0.2.0 add a built-in backup CLI, or document `pg_dump` + volume tar in the README?
- Yjs migration: store the Yjs CRDT as an additional column on `pages` or as a separate `page_snapshots` table?
- Multi-workspace switching: domain-routing (`workspace.example.com`) vs. path-routing (`/w/<slug>`)?

## 7. Glossary

- **Block**: a node in the TipTap/ProseMirror document tree (paragraph, heading, callout, etc.)
- **Page**: a top-level editable document; can have children (nested pages)
- **Database**: an inline block holding rows and properties; rendered via one or more views
- **View**: a configured presentation of a database (table, kanban, gallery) with sort/filter/group_by
- **Workspace**: a tenant boundary; all pages, databases, members, and files belong to exactly one workspace
