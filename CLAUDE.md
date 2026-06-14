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
- Tailwind CSS v4 (CSS-first: `@theme` in `src/app/globals.css`, no `tailwind.config.*`; PostCSS via `@tailwindcss/postcss`) + shadcn/ui (new-york style), `next-themes`. Animations via `tw-animate-css`.
- TipTap 3 editor (`src/components/editor/`), custom node extensions for callout, image, file, database. Utility extensions come from the consolidated `@tiptap/extensions` (Placeholder, CharacterCount) + `@tiptap/extension-list` (TaskList/TaskItem).
- Biome v2 for lint+format (replaces ESLint+Prettier). Vitest v4 (+ `vite` as an explicit dev dep, required by Vitest 4) + Testcontainers v12 (real Postgres) for tests.
- Zod v4 for validation (top-level `z.email()`/`z.url()`/`z.uuid()`). TypeScript 6 strict.
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
- **`@types/node` is pinned to v24** to match the runtime (Node 24 LTS in `engines`, `.nvmrc`, Dockerfile `NODE_VERSION`, CI `setup-node`). Do NOT bump it past the deployed Node major (currently 24, e.g. to 25+) — keep it aligned with the deployed Node, or types will describe APIs the runtime doesn't have.
- **pnpm 10+ does NOT run dependency build scripts by default** (supply-chain hardening). The allowlist lives in `pnpm-workspace.yaml` under `allowBuilds:` (a map of `pkg: true|false` — pnpm 11's format; the older `onlyBuiltDependencies` list is ignored by 11.x). Cairn enables `esbuild`, `sharp`, `onnxruntime-node`, `cpu-features`, `ssh2`, `protobufjs`; `@scarf/scarf` stays `false` (telemetry). If a native dep (sharp/onnxruntime) or `esbuild` is missing its binary after install, it was dropped from `allowBuilds`. pnpm re-stubs the map with `set this to true or false` placeholders if it sees an un-approved build — replace those with booleans. Build scripts only run on a fresh install (`rm -rf node_modules && pnpm install`), not on a lockfile-current re-install.
- **Vitest test isolation MUST stay on (`isolate: true`).** `tests/helpers/db.ts` holds a module-level Testcontainers Postgres singleton with per-file `beforeAll(startPostgres)`/`afterAll(stopPostgres)`. With `isolate: false`, module state is shared across files, so the first file's `afterAll` tears down the container later files still expect → mass `ECONNREFUSED`. The pool is `forks` + `maxWorkers/minWorkers: 1` (serial) with isolation ON, which is the Vitest 4 equivalent of the old `singleFork: true`.
- **i18n hardcoded-string gate (`pnpm i18n:check`).** `scripts/i18n-audit.ts` scans `src/**` for user-facing English string literals (JSX text + `aria-label`/`placeholder`/`title`/`alt`) and fails CI when a finding is NEW vs `i18n-audit.baseline.json`. New **client** copy must go through `t()` with keys added to ALL of `messages/{en,es,ar}.json` (the `t()` plural helper looks up `key.{one,other}` when a `count` number param is passed; non-`count` params interpolate `{name}`). New **server-component** chrome (settings page `<h1>`/descriptions) has no server-side `t()` — match the existing convention and record it in `i18n-audit.baseline.json` (regenerate by deleting the file and running `pnpm i18n:check`, or splice the entries in). Escape hatch for a genuine non-translatable string: `// biome-ignore i18n: <reason>` on the line.
- **Bundled wasm/native deps need `process.getBuiltinModule`.** In the Turbopack `output: 'standalone'` build, a server module that locates a sibling on-disk asset (e.g. sql.js's `sql-wasm.wasm` for the `.apkg` export) CANNOT use `createRequire(import.meta.url).resolve('pkg')` — Turbopack folds the literal to a numeric module id (`path.dirname(<number>)` throws) and a dynamic specifier throws "expression too dynamic". Use the REAL Node builtins via `process.getBuiltinModule('module'|'fs'|'path')` (Node 22.3+), mark the dep `serverExternalPackages`, pin its non-JS assets via `outputFileTracingIncludes`, and pass the bytes (e.g. `wasmBinary`) yourself. Symptom: route 500s only in the built standalone server but passes under vitest. See `src/lib/flashcards/apkg.ts`.

## Release process

- **Branch model:** items land on a `release/vX.Y.Z` branch via squash-merged PRs (one PR per item). At ship time the release branch is merged to `main` (merge commit) and the tag is cut on `main`. `main` is unprotected but the convention is a PR/merge-commit, not force-push.
- **Tagging triggers the image build.** `.github/workflows/release.yml` fires on `push` of a `v*.*.*` tag, builds multi-arch (`linux/amd64` + `linux/arm64`) on native runners, and publishes `ghcr.io/jonathanmcohen/cairn` + `ghcr.io/jonathanmcohen/cairn-collab` at `${tag#v}` (the leading `v` is stripped — tag `v0.10.2` → image `:0.10.2`).
- **No release candidate unless explicitly asked.** Default to cutting the final `vX.Y.Z` tag directly. Only cut a `vX.Y.Z-rcN` prerelease when the request says so.
- **Carry-forward gate (Gate 4).** On a FINAL tag the `verify-carry-forward-closed` job fails the release if any GitHub issue labeled BOTH the tag (e.g. `v0.10.2`) AND `carry-forward` is still open. It is **skipped for prerelease tags** (`if: !contains(ref_name, '-')`, so any `-rcN`/`-betaN` tag bypasses it). The query no-ops cleanly when the label doesn't exist.
- **Tagged-commit e2e gate.** `verify-item-e2e` runs the full `tests/e2e` suite at the tagged commit BEFORE any image build, for both rc and final tags — `build` depends on it, so a RED item spec blocks the image.
- **Release prep before tagging:** bump `package.json` version, add the `## [X.Y.Z] - YYYY-MM-DD` CHANGELOG section, run `pnpm notes:gen` (regenerates `src/lib/release-notes/notes.generated.ts` for the in-app What's-new panel; a drift test enforces it and `pnpm build` re-runs it).

## Commands

```sh
source ~/.zshenv && pnpm dev        # http://localhost:3000
source ~/.zshenv && pnpm test       # vitest (needs Docker for testcontainers)
source ~/.zshenv && pnpm lint       # biome
source ~/.zshenv && pnpm typecheck  # tsc --noEmit
source ~/.zshenv && pnpm build      # next build + entrypoint tsc
source ~/.zshenv && docker compose up -d --build   # full stack
```
