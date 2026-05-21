# Changelog

All notable changes to Cairn will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## [Unreleased]

### Added (v0.2.0 Plan 1 — OAuth & user model)
- `0007` migration: `users.email_verified` + `users.image`, `pages.published` + `pages.public_slug`.
- Google + GitHub OAuth providers, enabled only when their env vars are set; "Continue with …" buttons appear conditionally on login/signup.
- Invite-gated OAuth sign-in: links to an existing account by verified email, consumes a matching invite for newcomers, otherwise denies (with an access-denied notice).
- Dropped the v0.1.0 Drizzle-adapter `any` cast now that the users table carries the adapter's expected columns.
- docker-compose passes through `AUTH_GOOGLE_*` / `AUTH_GITHUB_*`.

### Added (v0.2.0 Plan 2 — Multi-workspace switching)
- Active workspace resolved from an httpOnly `cairn_ws` cookie in `getAuthContext`, re-validated against live membership on every call (forged/stale cookie falls back to the oldest membership).
- `POST /api/workspaces` — any authenticated user creates a workspace and becomes its owner; the new workspace is set active.
- `POST /api/workspaces/switch` — set the active workspace for a workspace the caller is a member of.
- `POST /api/workspaces/[id]/leave` — leave a workspace; rejected for the sole owner (no transfer/delete in v0.2.0).
- `POST /api/invites/accept` — a logged-in user accepts an invite (email must match), joining with the invited role.
- Sidebar workspace switcher (switch / create / invite) and an `/invite/[token]` landing page.
- "No workspace" empty state for a logged-in user with no memberships, instead of redirecting to login.

## [0.1.0] - 2026-05-20

### Added (Plan 6 — Release polish)
- Floating drag handle UI for per-block actions (move up/down, duplicate, delete).
- GitHub Actions release workflow: tag-triggered, multi-arch (amd64+arm64), publishes to ghcr.io, generates SBOM + provenance attestations, creates a GitHub Release.
- SECURITY.md and CONTRIBUTING.md.
- Polished README with feature list, configuration table, and image badges.
- CLAUDE.md project guide.

### Added (Plan 5 — Databases)
- 5 new tables (`databases`, `db_properties`, `db_rows`, `db_cells`, `db_views`) + property/view type enums.
- Server helpers: create/get database, property CRUD with type-specific config validation, row+cell CRUD with type coercion, view CRUD.
- Filter compilation (AND of conditions, 8 ops across 7 property types) and multi-column sort compilation.
- API under `/api/databases/...` for databases, properties, rows (filter/sort query), and views.
- TipTap `database` node inserted via slash menu, rendered as a React node view.
- Table view (inline cell editing), kanban view (drag-to-reclassify), gallery view (cards).
- View switcher with add-view, property panel with add-property.

### Added (Plan 4 — Files & markdown)
- `files` table, `pages.cover_url` column, signed file URL helpers.
- `POST /api/upload` (role+size+mime gated) and `GET /api/files/[id]?sig=&exp=` (HMAC-streamed).
- Image and file attachment blocks in the editor; drag/drop + paste image support.
- Cover image picker on the page route.
- Markdown export per page (`.md`) and per subtree (`.zip`).
- Markdown import via overflow menu and via pasting raw markdown into the editor.

### Added (Plan 3 — Search & trash)
- Postgres full-text search with `pg_trgm` trigram fallback for typo-tolerant title matching.
- `searchPages` helper returning snippets (`ts_headline`) and breadcrumbs.
- `GET /api/search` route (viewer+, workspace-scoped).
- ⌘K command palette with debounced query, arrow nav, breadcrumb path display.
- Trash bin: `listTrash`, `restorePage` (cascade-aware via `deleted_root`), `hardDeletePage`.
- Trash API: `GET /api/trash`, `POST /api/pages/[pageId]/restore`, `DELETE /api/trash/[pageId]`.
- `/trash` route with Restore + Delete-forever actions.
- `autoPurge` with `pg_try_advisory_xact_lock` and 1-hour throttle; fired opportunistically from trash and pages routes.
- `system_meta` key/value table for cross-process flags (currently: `last_purge_at`).

### Added (Plan 2 — Pages & block editor)
- Pages table with FTS columns/trigger and self-referential parent.
- Page CRUD APIs (create, read, update, soft-delete, move) with role gates and workspace scoping.
- Cycle detection on page move; cascade soft-delete with `deleted_root` flag.
- Recursive sidebar page tree (server-rendered) with new-page button.
- Empty-state CTA on the dashboard.
- Page route with inline title rename and emoji icon picker.
- TipTap editor (paragraph, H1/H2/H3, bullet/numbered/task lists, blockquote, code with syntax highlight, callout in 4 colors, divider).
- Slash command menu for block insertion.
- Debounced autosave (800 ms) with optimistic UI and stale-write conflict notice.
- ⌘N keyboard shortcut to create a new page.
- React `cache()` wrap on `getAuthContext` to dedupe per-request DB hits.
- Fixed Next.js `typedRoutes` deprecation.

### Added (Plan 1 — Foundation)
- Multi-tenant workspace model with email/password authentication.
- First-user bootstrap (creates workspace, becomes owner) and invite-token signup for subsequent users.
- Roles: owner, admin, editor, viewer (enforced via `requireRole` helper).
- Admin-only invite token issuance API.
- Health endpoint at `/api/health` with database probe and version reporting.
- Light/dark/system theme with toggle.
- Authenticated dashboard shell with sidebar (workspace name, version footer).
- Dockerfile (multi-stage) and docker-compose for app + postgres.
- GitHub Actions CI: lint, typecheck, test with Postgres service container, build smoke.
- Repository scaffolding: Biome (lint/format), Vitest with testcontainers, Drizzle ORM with migrations applied at startup.
