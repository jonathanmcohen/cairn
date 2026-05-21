# Cairn — Project Guide for Claude

Cairn is a **self-hosted, Notion-style block-based notes app** for homelab deployment, built from scratch (not a fork). Single Next.js container + Postgres, deployed via docker-compose.

## Current state

- **Version:** see `package.json` (`0.1.0` at first release).
- **Roadmap:** `docs/superpowers/roadmap-0.2-to-0.5.md` (post-v0.1.0 plan).
- **Specs/plans:** `docs/superpowers/specs/` and `docs/superpowers/plans/`. Each release milestone is one spec + a sequence of numbered plan docs.
- **Repo:** `github.com/jonathanmcohen/cairn`. Image published to `ghcr.io/jonathanmcohen/cairn` on `v*.*.*` tags.

## Tech stack

- Next.js 16 (App Router, React 19, TypeScript strict, Turbopack) — single full-stack process, `output: 'standalone'`. The auth gate lives in `src/proxy.ts` (Next 16 renamed `middleware` → `proxy`, nodejs runtime).
- Postgres 16 + Drizzle ORM. Migrations in `drizzle/migrations/`, applied at container startup via `src/server/entrypoint.ts`.
- Auth.js v5 (NextAuth), **credentials provider with `jwt` session strategy** (NOT database — Credentials requires jwt; see Gotchas).
- Tailwind + shadcn/ui (new-york style), `next-themes`.
- TipTap 2 editor (`src/components/editor/`), custom node extensions for callout, image, file, database.
- Biome for lint+format (replaces ESLint+Prettier). Vitest + Testcontainers (real Postgres) for tests.
- pnpm only. `cmdk` for the ⌘K palette, `archiver` for zip export, `marked` for markdown import, `prosemirror`-style JSON walker for export.

## Architecture conventions

- **Multi-tenant:** everything is workspace-scoped. Roles: `owner > admin > editor > viewer` via `src/lib/auth/require-role.ts` (`requireRole`, `hasMinRole`, `getAuthContext` — wrapped in React `cache()`).
- **Page access:** `src/lib/pages/access.ts#requirePageAccess(pageId, role)` validates workspace ownership + role and returns `{page, ctx}`. Cross-workspace access returns 404 (not 403) to avoid leaking existence.
- **Pages:** content is ProseMirror/TipTap JSON in `pages.content` (jsonb). A Postgres trigger keeps `content_text` + `content_tsv` in sync for FTS. Nested via self-referential `parent_id` (FK added manually in migration — Drizzle can't model self-FKs in the callback form). Soft-delete via `deleted_at` + `deleted_root` (the latter scopes cascade restore).
- **Search:** Postgres FTS (`content_tsv`) + `pg_trgm` trigram fallback on title for typos. `src/lib/pages/search.ts`.
- **Files:** local disk under `/data/uploads/<workspace>/<uuid>.<ext>` via a pluggable `FileStorage` interface (`src/lib/files/storage.ts`). Reads go through HMAC-signed URLs (`/api/files/[id]?sig=&exp=`), never raw paths.
- **Databases (inline):** 5 tables (`databases`, `db_properties`, `db_rows`, `db_cells`, `db_views`). Cells are jsonb keyed by property id, type-coerced on write. Filter/sort compiled to SQL in `src/lib/databases/filter.ts` + `sort.ts`. Three views: table/kanban/gallery.
- **API routes** live in `src/app/api/...`, all gated by `requireRole`/`requirePageAccess`. Business logic lives in `src/lib/...` helpers (pure, db-injected) so it's unit-testable without HTTP.

## Working conventions (IMPORTANT for any shell command)

- **PATH quirk:** the Bash tool's shell does NOT auto-source `~/.zshenv`. Homebrew (`/opt/homebrew/bin`) — and therefore `node`, `pnpm`, `docker` — is not on PATH by default. **Prefix every shell command with `source ~/.zshenv && `.** `~/.zshenv` also sets `DOCKER_HOST` (Colima socket) and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE`.
- **Docker** is provided by **Colima** (not Docker Desktop). `colima start` if the daemon is down. Tests use Testcontainers → require Docker running.
- **TDD:** write the failing test first, then the implementation. Tests use Testcontainers Postgres; integration tests TRUNCATE tables in `beforeEach`. API-route tests `vi.mock('@/lib/auth/config')` and expose a `__set` helper to fake the session.
- **Verify before commit:** `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test`. For UI/route changes also `pnpm build`.
- **Biome auto-fixes:** it reorders imports (alphabetical, `@/` aliases interleaved), converts namespace imports used only as types to `import type`, and reflows long lines. Just run `biome check --write` (or `pnpm lint` then accept) — these are expected.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`). Frequent, one logical change each.
- **Do not push** from subagents; the controller/human pushes.

## Development workflow used on this project

Plans are executed **subagent-driven**: one implementer subagent per plan task (fresh context, full task text pasted in), main thread reviews/commits between tasks. Plan docs are bite-sized TDD steps with full code, exact paths, and commit commands. See `docs/superpowers/plans/*.md`.

## Gotchas discovered (don't re-learn these)

- **Auth.js + Credentials needs `session.strategy: 'jwt'`.** Using `'database'` throws `UnsupportedStrategy` at the credentials callback → browser sign-in silently breaks. Unit tests don't catch it (they mock `auth()`); only e2e smoke does. The DrizzleAdapter is still wired so OAuth can be added later; the `sessions`/`accounts` tables are inert under jwt.
- **`env()` caches on first call.** Tests that override env vars (e.g. `CAIRN_MAX_UPLOAD_MB`) must read `process.env` directly, not via the cached `env()`.
- **`.env` is dual-purpose.** docker-compose reads `DB_PASSWORD` + `PUBLIC_URL` to interpolate; `pnpm dev/build/test` read the full `DATABASE_URL`/`AUTH_SECRET`/`NEXTAUTH_URL` directly. A fresh clone must `cp .env.example .env` (the full set), not the compose-only subset.
- **CI pnpm version:** `pnpm/action-setup@v4` errors if both a `version:` input AND `packageManager` in package.json are set. Rely on `packageManager: "pnpm@9.12.0"` only.
- **Recursive CTEs** (page tree, descendants, breadcrumbs) use raw SQL via `db.execute(rawSql\`...\`)` — Drizzle can't express them. `tx.execute()` returns rows directly (no `{rows}` wrapper); cast `as unknown as Row[]`.
- **`db:generate` doesn't emit extensions/triggers/self-FKs** — append those to the generated migration SQL by hand (see `pages` trigger, `pg_trgm`, self-FK).
- **typedRoutes:** dynamic hrefs (`/pages/${id}`) need `as Route` (`import type { Route } from 'next'`).
- **Node Readable → web Response** for file/zip streaming needs a `// @ts-expect-error` (type mismatch persists, but works at runtime in Next 16).

## Commands

```sh
source ~/.zshenv && pnpm dev        # http://localhost:3000
source ~/.zshenv && pnpm test       # vitest (needs Docker for testcontainers)
source ~/.zshenv && pnpm lint       # biome
source ~/.zshenv && pnpm typecheck  # tsc --noEmit
source ~/.zshenv && pnpm build      # next build + entrypoint tsc
source ~/.zshenv && docker compose up -d --build   # full stack
```
