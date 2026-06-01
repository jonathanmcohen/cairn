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
  Silicon Mac w/ Docker Desktop — Linux VM produces real `linux/arm64`
  layers despite the macOS host)

Runners must carry the labels above verbatim. Docker + recent
`pnpm`/`node` available. The arm64 runner is used only by the release
workflow's per-arch image build; everything else (CI, lighthouse,
manifest merge, GitHub Release step, postgres-pgvector image build)
runs on the x64 runner.

GHA-hosted runners are not used — GH Actions minute budget has hit the
ceiling twice during 0.x development, so self-hosted is the durable
operating posture. The workflows carry self-hosted-specific
workarounds:

- `ci.yml` security job: `rm -f /tmp/gitleaks.tmp` before the gitleaks
  action (self-hosted `/tmp` persists between runs).
- `release.yml` macOS arm64 build: redirects `DOCKER_CONFIG` to a
  per-run temp dir with plain `auths` block (Docker Desktop's keychain
  credstore can't be unlocked headless) + sets `DOCKER_HOST` at
  `~/.docker/run/docker.sock` (the user-scoped socket when "Allow
  default Docker socket" is OFF in Docker Desktop) + skips
  `docker/login-action` on macOS.
- `release.yml` merge job: self-installs `jq` from upstream releases if
  not present (some Linux self-hosted images lack it).

Switching back to GHA-hosted: swap `[self-hosted, linux, x64]` →
`ubuntu-latest` and the release matrix expression →
`'ubuntu-latest' || 'ubuntu-24.04-arm'`. Strip the three workarounds
above (no-op on GHA images).

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

## WebAuthn / passkeys (v0.9.0 G1 P8)

Cairn supports passkeys (WebAuthn FIDO2 credentials) as a complement to the
v0.6 P19 TOTP authenticator. Users can enroll either, both, or neither —
subject to the per-workspace MFA policy (see Admin enforce below).

**Required env vars (only when WebAuthn is exposed):**

- `CAIRN_RP_ID` — the **registrable domain** of your deployment. Host only,
  no scheme or port (e.g. `cairn.example.com`). Credentials bind to this
  value forever; **changing it after enrollment invalidates every passkey**.
- `CAIRN_RP_ORIGIN` — the **full origin** (scheme + host + port) that the
  browser sends in the WebAuthn ceremony (e.g. `https://cairn.example.com`).
  **Must match the origin of `NEXTAUTH_URL`.** A mismatch causes the same
  permanent invalidation as changing `CAIRN_RP_ID`.
- `CAIRN_RP_NAME` — human-readable name shown in the authenticator prompt
  during enrollment. Defaults to `Cairn`.

Leaving these unset is supported and means the `/api/webauthn/*` routes
respond with 503 — the enrollment page at `/settings/security/passkeys`
likewise short-circuits to an "operator has not enabled WebAuthn" banner.

**Startup sanity check:** `src/server/entrypoint.ts` parses
`CAIRN_RP_ORIGIN` and `NEXTAUTH_URL` at container start and logs a
structured warning to stderr if the origins disagree. Inspect every fresh
container's log line zero for the warning before letting users enroll.

**Recommended values for the default docker-compose deployment:**

```
CAIRN_RP_ID=cairn.example.com         # NOT https://...., NOT a port
CAIRN_RP_NAME=Cairn
CAIRN_RP_ORIGIN=https://cairn.example.com
NEXTAUTH_URL=https://cairn.example.com
```

**Admin-enforce policy:** workspace admins can require MFA enrollment for
all members via `PUT /api/admin/workspaces/<workspaceId>/mfa-policy`
(surfaced at `/settings/admin/mfa`). When enabled, sign-in for a member
without any enrolled MFA method (TOTP or WebAuthn) returns
403 `mfa-enrollment-required` and the login screen links them to the
enrollment page.

**Step-up:** the workspace-delete admin action (and any future
opt-in destructive surface) requires a fresh WebAuthn assertion (within
5 minutes). Missing / stale returns 403 `stepup-required`; the UI triggers
the assertion inline and retries the request on success.

## Release watch (v0.9.0 G8 P42)

When `CAIRN_SCHEDULER_ENABLED=1` is set and the scheduler is running, the
boot path registers a global `release-watch:tick` row in `cron_schedules`
(daily at 04:30 UTC). Each tick fetches `CAIRN_RELEASE_FEED_URL`, finds
the highest stable semver tag in the response, and inserts one
`upgrade_available` notification per (admin/owner, workspace) whose
latest known version is older than the upstream tag. The fan-out is
idempotent per (user, workspace, version): re-runs at the same version
insert zero rows; a newer feed inserts only the missing rows. The
notification bell + `/notifications` drawer render the
`upgrade_available` type with a link to `/settings/admin/upgrade`.

```env
# Defaults (no config needed unless you want a mirror or to opt out):
CAIRN_RELEASE_FEED_URL=https://api.github.com/repos/jonathanmcohen/cairn/releases
CAIRN_RELEASE_WATCH_ENABLED=true
```

**Auto-apply is OFF.** The daemon only inserts notifications. The
`/settings/admin/upgrade` page renders current vs available version and
exposes an "Apply upgrade now" button that streams `cairn-upgrade apply`
via SSE — that is the *only* path that actually runs `applyUpgrade`.

**Air-gapped deploys** set `CAIRN_RELEASE_WATCH_ENABLED=false`; the cron
registration is skipped at boot and operators upgrade out-of-band.

**Mirrors / private feeds:** point `CAIRN_RELEASE_FEED_URL` at any
endpoint returning a JSON array of
`{ tag_name, html_url, draft, prerelease }` objects (the GitHub Releases
v3 shape). Drafts and prereleases are filtered out; the highest
semver-valid stable tag wins. GitHub API rate-limit responses
(`X-RateLimit-Remaining: 0`) and non-2xx responses are surfaced as
`feedError` on the tick result and never crash the cron.

## Encrypted backup passphrase rotation

Cairn's backup CLI (v0.5 P5 — see `cli backup`) optionally wraps every
on-disk artefact in an AES-256-GCM envelope when
`CAIRN_BACKUP_ENCRYPTION_PASSPHRASE` is set (v0.9.0 G8 P43). The dump
(`cairn-backup-<ts>.dump`) and the uploads tar
(`cairn-uploads-<ts>.tar.gz`) gain a `.enc` suffix; the manifest stays in
plaintext and gains an `"encrypted": true` flag. The passphrase is the
**only** thing that can decrypt the archives — there is no recovery path
if you lose it. Rotation must be a planned operation.

### Envelope format

`[magic: 16][salt: 16][nonce: 12][ciphertext: variable][auth tag: 16]`,
where `magic = "CAIRN-ENC-BAK-v1"`. The salt feeds Argon2id
(`memoryCost=64 MB`, `timeCost=3`, `parallelism=1`) to derive a 256-bit
key. The nonce is the GCM IV. The auth tag is appended at the tail and
detects any single-bit tamper or wrong-passphrase attempt on `decrypt`.

### Procedure

1. **Snapshot current state.** Confirm the NEW passphrase is stored in
   your secret manager (1Password, AWS Secrets Manager, etc.) BEFORE
   rotating, and that the OLD passphrase is still accessible.
2. **Run a fresh backup** with the OLD passphrase still set, and verify
   it restores end-to-end (see "Verify" below). Don't rotate until you
   trust the current passphrase round-trips.
3. **Decrypt every retained archive to local plaintext.** For each
   `<dir>/cairn-backup-<ts>.dump.enc` and matching
   `cairn-uploads-<ts>.tar.gz.enc`:

   ```sh
   # The CLI handles this transparently on restore — but for offline
   # re-encryption you can stream-decrypt with a one-liner:
   CAIRN_BACKUP_ENCRYPTION_PASSPHRASE="$OLD" \
     node -e 'require("./dist/lib/backups/encryption.js")
       .decryptBackup(process.env.CAIRN_BACKUP_ENCRYPTION_PASSPHRASE)
       .pipe(process.stdout)' \
     < /backups/cairn-backup-<ts>.dump.enc \
     > /tmp/rotation/cairn-backup-<ts>.dump
   ```
4. **Re-encrypt with the NEW passphrase**:

   ```sh
   CAIRN_BACKUP_ENCRYPTION_PASSPHRASE="$NEW" \
     node -e 'process.stdin
       .pipe(require("./dist/lib/backups/encryption.js")
         .encryptBackup(process.env.CAIRN_BACKUP_ENCRYPTION_PASSPHRASE))
       .pipe(process.stdout)' \
     < /tmp/rotation/cairn-backup-<ts>.dump \
     > /backups/cairn-backup-<ts>.dump.enc
   ```
5. **Update the env var on the Cairn host** to the new passphrase. The
   next scheduled `cli backup` run encrypts with the new key.
6. **Securely shred the plaintext** in `/tmp/rotation/`
   (`shred -u` on Linux, `rm -P` on macOS) before reboot.

### Verify

```sh
CAIRN_BACKUP_ENCRYPTION_PASSPHRASE="$NEW" \
  node dist/server/cli.js restore --in /backups/cairn-backup-<ts>.dump.enc --force
```

A wrong passphrase exits non-zero with
`decryption failed: auth tag mismatch (wrong passphrase or tampered
ciphertext)`. No partial plaintext lands on disk.

### Failure modes

- **Wrong passphrase on decrypt.** The CLI exits non-zero with the
  message above. The original `.enc` file is left intact; no partial
  plaintext is produced.
- **Tampered envelope.** Same failure mode — GCM's auth tag detects any
  flipped bit in the ciphertext.
- **Missing magic.** `envelope magic mismatch (not a CAIRN-ENC-BAK-v1
  stream)`. You are pointing the CLI at a raw dump from before the
  encryption env was set; restore that one without
  `CAIRN_BACKUP_ENCRYPTION_PASSPHRASE` in the environment.
- **`.enc` bundle, env var unset.** The restore path refuses outright
  rather than attempt the dump: `bundle ... is encrypted (.enc) but
  CAIRN_BACKUP_ENCRYPTION_PASSPHRASE is unset`.

### Notes

- The passphrase env name is in the v0.7 secret-leak `FORBIDDEN_KEYS`
  set + the `pino` redact list — Cairn does not log or echo it via any
  API surface.
- This procedure is **distinct from v0.9.0 G1 P5–P7 E2E page-content
  encryption**. Per-page encryption protects the `pages.content` jsonb
  inside the DB; the envelope protects the entire `.dump` (which
  contains the ciphertext rows AND every other table) at rest on disk.
  Both can coexist for defense-in-depth.

## Collaboration auth (shared AUTH_SECRET)

The `cairn` app and the `cairn-collab` real-time service form a single trust
domain joined by **one shared secret: `AUTH_SECRET`**. The app mints a collab
token via `mintCollabToken` (HMAC-SHA256 over `{userId, pageId, role, exp}`,
5-minute TTL) at `/api/collab/token`; `cairn-collab`'s `onAuthenticate` verifies
it with `authorizeCollab` using the same secret. There is intentionally **no
separate collab secret** (no `HOCUSPOCUS_SECRET`) — one secret to rotate, one
to keep in sync.

Operational consequences:

- **Keep `AUTH_SECRET` identical** across both services. In the shipped
  `docker-compose.yml` both read `${AUTH_SECRET}` from `.env`; if you template
  the secret per-service (e.g. a secrets manager), inject the same value into
  both.
- **Rotating `AUTH_SECRET`** invalidates all in-flight collab tokens (TTL ≤ 5
  min) and all app sessions. Restart both services together; live editors
  reconnect within a few seconds.
- **Diagnosing rejections**: `cairn-collab` logs
  `reason=bad-sig|expired|page-mismatch|malformed` with the decoded (untrusted)
  `tokenPageId`/`exp` — never the secret or the raw token. `bad-sig` almost
  always means the two services' secrets drifted.
- **DNS resolvability is a hard dependency.** The browser connects directly to
  `COLLAB_URL` and the app mints tokens against `PUBLIC_URL`; both must resolve
  from the **client's** network, not only inside Docker. A non-resolving
  hostname (or a reverse proxy that drops the WebSocket upgrade) presents the
  same `cairn-collab: rejected connect` / `Unauthorized` symptom as a secret
  mismatch. Since v0.9.8 the client retries the token fetch with exponential
  backoff and shows a dismissible "Collab offline — reconnecting…" banner, so
  the editor recovers automatically once resolution is restored.
