# Cairn — Operations Guide

## Scheduled backups, reminders & quotas

The app does **not** host a cron daemon (design decision 36). Two options:

- **Recommended: external cron.** A host crontab / systemd timer / Kubernetes CronJob invoking
  `docker compose exec app pnpm cli backup --out /data/backups --retention-days 14 --target s3`
  on whatever cadence you choose. Reminders (P22) use the same pattern with `pnpm cli reminders:scan`.
- **Opt-in interval ticker (single-instance only).** Setting `CAIRN_BACKUP_INTERVAL` (and the P22
  `CAIRN_REMINDER_INTERVAL`) to a duration enables an in-process `setInterval` in `entrypoint.ts`
  that runs the same CLI work. **OFF by default.** **Explicitly single-instance:** two app
  instances each run their own ticker and will double-fire backups/reminders — there is no
  distributed lock for v1.0 (consistent with the single-instance Hocuspocus collab ceiling).
  Use external cron if you run more than one instance.

### Flags

- `--retention-days N` — prune bundles older than N days in `--out` after a successful run.
- `--target s3` — additionally mirror the produced bundle into the configured `FileStorage`
  (S3/MinIO) under `backups/`. `FILE_BACKEND=local` + `--target s3` is supported; the database
  dump still lands in `--out` and is then copied to the bucket.
- `pnpm cli reconcile [--workspace <id>]` — recompute `storage_bytes_used` from the actual
  stored files. Run it after a restore or if you suspect counter drift.

### Embedding backfill (one-time, opt-in)

Setting `CAIRN_BACKFILL_EMBEDDINGS=1` on the first boot after upgrading to v0.7.0 kicks a one-time
background pass that embeds every page lacking an embedding (or whose `content_text` has changed
since the last embed). Same single-instance ceiling as `CAIRN_BACKUP_INTERVAL` — two app processes
both run their own pass and burn extra embedding-provider calls. Prefer running
`pnpm cli reindex-embeddings` from a one-shot container if you operate multi-instance.

After the first pass, unset the env. The on-write hook in `src/lib/pages/update.ts` +
`src/lib/pages/create.ts` keeps embeddings current going forward. The CLI accepts
`--workspace <id>` to restrict the pass and `--batch-size N` (default 16) to tune parallelism.

### Cron-driven CLI scheduler (opt-in)

Setting `CAIRN_SCHEDULER_ENABLED=1` boots an in-process scheduler that polls `cron_schedules`
every 60 seconds, exec'ing any due, enabled row as `node dist/server/cli.js <command>`. Use it
to schedule recurring backups, exports, reindexes, or reconciles from inside the container.

Manage schedules by inserting/updating rows directly (no admin UI in v0.7.0). Example for a
nightly S3 backup:

```sql
INSERT INTO cron_schedules (command, cron_spec, next_run_at)
VALUES (
  'backup --target s3 --out /data/backups --retention-days 14',
  '0 2 * * *',
  now()
);
```

The scheduler advances `next_run_at` via `cron-parser` after each run and writes `last_run_at`
+ `last_status` (`'success'` | `'failure'`) + `last_error`. A malformed `cron_spec` disables the
row to prevent a poison loop.

**SINGLE-INSTANCE only** — same ceiling as `CAIRN_BACKUP_INTERVAL`. Two app processes both poll
and double-fire each due row. Multi-instance deployments should disable this scheduler and use
external cron / Kubernetes CronJob to invoke the same CLI.

### Connector sync (`connector:sync`)

`pnpm cli connector:sync [--connector <id>]` runs one round-trip of the v0.7.0 connector engine
(P19) — fetches each enabled connector's external rows, diffs against `connector_row_map`, pushes
Cairn-side changes to the adapter, applies external-side changes locally, and captures both-changed
cells into `connector_conflicts` for resolution via the per-connector inbox.

Without `--connector`, syncs every enabled connector in every workspace. Adapter wiring lands in
P20 (Google Sheets), P21 (Airtable), and P22 (CSV) — until then the framework has no registered
adapters and the command is a no-op.

**SINGLE-INSTANCE only** — same ceiling as the rest of this section. Running it twice in parallel
on the same connector double-pushes (and may double-create unmapped Cairn rows). Schedule it via
the cron table above (e.g. `cron_spec '*/5 * * * *'` for 5-minute polls) or external cron.

### Restore from S3

`pnpm cli restore --from-s3 backups/cairn-backup-<ts>.dump [--force]` downloads the bundle
from the configured `FileStorage` (driven by `FILE_BACKEND` / S3 env vars) into a temp file
under `os.tmpdir()`, then runs the existing `restore` path (`pg_restore --clean --if-exists`).
Mutually exclusive with `--in`. Use it when backups land in S3/MinIO via
`backup --target s3` and you want to restore without first copying the bundle back to local
disk.

### MCP SSE fallback session store

The legacy SSE-fallback transport (`GET /api/mcp/sse` + `POST /api/mcp/messages`) keeps
its session-to-stream mapping in process memory (`src/lib/mcp/session-store.ts`). The
Streamable HTTP transport (`POST /api/mcp`) is stateless and unaffected.

**Implication for multi-instance deployments:** the SSE `GET` and the corresponding
`/api/mcp/messages` POSTs MUST land on the same process. Without sticky-session
load balancing on the `/api/mcp/sse` + `/api/mcp/messages` pair, POSTs will see
`404 session not found`. Configure your reverse proxy / ingress to pin these two
routes by `sessionId` query parameter, or accept that the SSE fallback is
single-instance only.

The default session idle TTL is 5 minutes (`SSE_SESSION_TTL_MS`); a background
sweep evicts idle sessions every 60 seconds.

## CI / Release runners

All workflows (`ci.yml`, `lighthouse.yml`, `release.yml`,
`postgres-pgvector-image.yml`) run on **self-hosted runners**:

- amd64: `[self-hosted, linux, x64]` (Linux box w/ Docker)
- arm64 (release matrix only): `[self-hosted, macOS, arm64]` (Apple
  Silicon Mac w/ Docker Desktop — Docker Desktop's Linux VM still
  produces real `linux/arm64` image layers)

Runners must have Docker + recent `pnpm`/`node` available. Required labels
match the values above verbatim. The arm64 runner is used only by the
release workflow's per-arch image build; everything else (CI, lighthouse,
manifest merge, GitHub Release step, postgres-pgvector image build) runs
on the x64 runner.

GitHub-hosted runners are NOT used — workflow billing for hosted minutes
was exhausted mid-v0.8.0, and self-hosted has been the operating
posture since.

## Postgres image (v0.8.0)

Cairn ships its own Postgres image with pgvector compiled in:

- **Source:** `docker/postgres-pgvector/Dockerfile` (postgres:18-alpine + pgvector master, built `with_llvm=no`).
- **Published to:** `ghcr.io/jonathanmcohen/postgres-pgvector` (tags `:18-alpine`, `:latest`), multi-arch (linux/amd64, linux/arm64).
- **Built by:** `.github/workflows/postgres-pgvector-image.yml` on every change to the Dockerfile.

The package is **private** — every consumer (CI services, Testcontainers, docker-compose) authenticates against GHCR before pulling.

**CI workflows.** `ci.yml` and `lighthouse.yml` set `permissions: packages: read`. CI services declare `credentials:` blocks; the `ci` job's `docker login` step authenticates the daemon so Testcontainers can pull during `pnpm test`.

**Local development.** Before `docker compose up` or `pnpm test`, run once:

```sh
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

`GHCR_TOKEN` is a classic personal access token with `read:packages`. The credential persists in `~/.docker/config.json`; re-login only when the token rotates.

**Volume layout note.** Postgres 18's image moved `PGDATA` from `/var/lib/postgresql/data` → `/var/lib/postgresql/18/docker`, and declares the upstream volume at `/var/lib/postgresql` (parent). Cairn's compose mount tracks the parent (`cairn_db:/var/lib/postgresql`) so future major bumps keep working without a new volume contract. **A pre-v0.8.0 deployment** running plain `postgres:16-alpine` with `/var/lib/postgresql/data` does NOT migrate cleanly — operators must `pg_dump` v0.7.x, recreate the volume, and `pg_restore` against the new image.

## DB query audit (v0.8.0)

Five hot routes audited via the v0.6 P20 `db_query_duration_seconds` metric.
The only call site that emits the metric today is `listRows` (label
`list_rows`), so the audit cross-references the metric scrape against the
nearest sibling queries on the same hot path — `getPageTree`,
`resolveEffectivePermission`, `getBreadcrumbs`, and the per-`listRows`
`db_properties` sub-query — for an end-to-end view of read-side latency.

| # | Route (template) | Operation label | Module | Pre p99 | Post p99 | Fix |
|---|---|---|---|---|---|---|
| 1 | `/api/v1/databases/:id/rows` (GET) | `list_rows` (rows fetch) | `src/lib/databases/rows.ts#listRowsInner` | Seq Scan over `db_rows` filtered by `(database_id, archived_at IS NULL)` then sort by `created_at` — wall-clock grows linearly with workspace row count | Index Scan via composite `(database_id, archived_at, created_at)`; the leading column narrows by database and the trailing column eliminates the explicit sort | `db_rows_database_archived_created_idx` |
| 2 | `/api/v1/databases/:id/rows` (GET) | `list_rows` (props fetch) | `src/lib/databases/rows.ts#listRowsInner` (props sub-query at line 279) | Seq Scan over `db_properties` for every `listRows` call — small per-database (<50 rows typical) but unbounded across workspaces; same scan shape is repeated in `relations.ts`, `properties.ts`, `get.ts` | Index Scan via `db_properties.database_id` btree | `db_properties_database_id_idx` |
| 3 | `/api/pages/tree` | (uninstrumented) | `src/lib/pages/tree.ts#flattenedPageTree` | `pages WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at` — already uses `pages_workspace_idx` then filters in memory | Plan optimal; no change | — |
| 4 | `/api/v1/pages/:id` ACL gate | (uninstrumented) | `src/lib/pages/acl.ts#resolveEffectivePermission` | Recursive CTE walks `parent_id` (PK + `pages_parent_idx`) then `LEFT JOIN page_acls` on the unique `(page_id, user_id)` index | Plan optimal; no change | — |
| 5 | `/api/v1/search` (FTS path) | (uninstrumented) | `src/lib/pages/search.ts#searchFts` + `getBreadcrumbs` | FTS hits `pages_content_tsv_idx` (GIN), trigram hits `gin_trgm_ops` (added in 0014), breadcrumbs walk `pages_parent_idx` | Plan optimal; no change | — |

The migration `drizzle/migrations/0029_add_perf_indexes.sql` is purely
additive (`CREATE INDEX`) — no column changes, no data rewrites — and the
Drizzle schema files (`src/db/schema/databases.ts`) carry matching
`index(...)` DSL entries so `db:generate` stays a no-op.

`EXPLAIN ANALYZE` raw plans are not committed; they're re-runnable from the
seed in `tests/a11y/seed.ts` + `scripts/seed-lhci.ts`.

## Lighthouse CI budget

A `.github/workflows/lighthouse.yml` workflow runs after the `CI` workflow
succeeds on `main`. It builds the app, applies migrations, seeds a fixed
published page (`/p/v08-lhci-seed-slug` via `scripts/seed-lhci.ts`), and
runs `lhci autorun` with `numberOfRuns=3` (median).

Budget (`.lighthouserc.json`):
- Performance score floor: 0.85 (warn).
- Largest Contentful Paint: ≤ 2500 ms median (warn).
- First Contentful Paint: ≤ 1800 ms median (warn).
- Time-to-Interactive: ≤ 3800 ms median (warn).

Severity is `warn` for the initial landing — promote to `error` after one
merged run establishes a stable baseline. LHCI writes each run report to
`.lighthouseci/` (filesystem upload target); the workflow's
`actions/upload-artifact` step preserves the directory as a 14-day-retained
artifact, so regressions are inspectable from the GitHub Actions run page.

> Deviation from the plan: the upload target is `filesystem` (not
> `temporary-public-storage`) so reports stay inside CI artifacts rather
> than an externally-hosted public URL.

## Server-side native PDF (v0.8.0)

Cairn ships two paths for the `format=pdf` page export. The default returns
print-ready HTML and relies on the browser's "Save as PDF" dialog — no
Chromium needed on the server. Setting `CAIRN_NATIVE_PDF=1` switches the
route to render real `application/pdf` bytes server-side via a headless
Chromium instance (powered by `@playwright/test`, which is a runtime
dependency as of v0.8.0).

**Trade-offs:**

- **Image growth:** ~150MB (the Chromium binary). The dependency itself is
  small; the bundled browser is what costs you the bytes.
- **Cold-start latency:** the first PDF request inside a process pays the
  Chromium-launch cost (~1.5s). Subsequent requests reuse a singleton
  `Browser` instance held in the route's module state. The browser closes
  on `SIGTERM` so the container exits cleanly.
- **Compatibility:** every block type prints identically to the
  browser-print HTML path — both paths render through the same
  `pageToPdfHtml(page)` HTML generator. Only the rasterizer differs.

**Explicit fallback selector:** `?format=pdf-print-html` always returns the
print-HTML body regardless of `CAIRN_NATIVE_PDF`, in case a caller wants
to bypass the native path.

**MCP:** the `pages.export` MCP tool accepts the same `format` param and
returns the PDF base64-encoded inside a JSON-RPC resource envelope. The
tool rejects `format=pdf` with `INVALID_REQUEST` when `CAIRN_NATIVE_PDF`
is unset (to keep the tool truthful — there is no MCP shape that can
deliver an HTML "save as" dialog).
