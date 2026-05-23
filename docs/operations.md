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

## Self-hosted CI / Release runners

`.github/workflows/ci.yml` and `.github/workflows/release.yml` target self-hosted runners by
default. A workflow-level `RUNNER_LABELS` (CI) / `RUNNER_LABELS_LINUX` + `RUNNER_LABELS_MAC`
(release) env constant is the single source of truth; each is overridable via a repository
variable (`CI_RUNNER_LABELS`, `RELEASE_RUNNER_LABELS_LINUX`, `RELEASE_RUNNER_LABELS_MAC`) so
the workflows can flip back to GitHub-hosted runners without editing the YAML — set the var
to `["ubuntu-latest"]` (or `["macos-latest"]`) in the repo settings.

### Linux x64 runner (CI + amd64 release build)

The user's runner is a containerized self-hosted runner — likely the
[`myoung34/docker-github-actions-runner`](https://github.com/myoung34/docker-github-actions-runner)
community image. GitHub auto-applies the labels `self-hosted`, `Linux`, `X64`, so the
workflows target `[self-hosted, Linux, X64]` with no custom label needed.

**Hard requirement: host Docker socket mounted.** The container needs
`-v /var/run/docker.sock:/var/run/docker.sock`, because:

- CI's `pnpm test` step runs **Testcontainers** to spin up a real Postgres 16 per worker pool.
  Without socket access, every test that imports `tests/helpers/db.ts` fails with
  `ECONNREFUSED` / `Cannot connect to the Docker daemon`.
- The release workflow's amd64 job runs `docker buildx build --platform linux/amd64` for the
  app image and the collab image.
- CI's `services: postgres` GHA service container (used by the `a11y` job's
  `pnpm db:migrate` step) needs the same daemon to start.

### macOS ARM64 runner (arm64 release build)

The arm64 release-build job targets `[self-hosted, macOS, ARM64]` — Apple Silicon. This works
because **Docker Desktop on Apple Silicon runs an arm64 Linux VM**, so
`docker buildx build --platform linux/arm64` is a native build with no QEMU emulation
(QEMU on an x64 host deadlocks during the v0.6.0 build; that's the reason for the split).

**Hard requirement: Docker Desktop installed and running.** Without it the release job has
no Docker daemon and the buildx step fails. Verify before kicking a release:

```sh
docker version  # must report Server: Docker Engine — running, not "Cannot connect"
```

The macOS runner only needs to run the **arm64 build job**. Shared jobs (lint/test, manifest
merge) stay on the Linux x64 runner.

### Caching across self-hosted runs

`actions/setup-node@v4` with `cache: pnpm` uses GHA's cache backend (not local disk), so the
pnpm store rehydrates between runs even on an ephemeral runner container. The CI `a11y` job
caches `~/.cache/ms-playwright` via `actions/cache@v4` keyed on `pnpm-lock.yaml` so Chromium
isn't re-downloaded on every run. The release workflow's buildx steps use
`cache-from: type=gha` / `cache-to: type=gha,mode=max` (GHA cache) so Docker layers persist
across runs without depending on the runner's local disk.

Persistent volumes for the runner's work directory improve speed further (npm/pnpm hot files,
`.next` build cache) but are not required for correctness — the GHA-backed caches above are
sufficient.

### Reverting to GitHub-hosted runners

Set the matching repository variable to an `ubuntu-latest` / `macos-latest` JSON array:

```sh
gh variable set CI_RUNNER_LABELS --body '["ubuntu-latest"]'
gh variable set RELEASE_RUNNER_LABELS_LINUX --body '["ubuntu-latest"]'
gh variable set RELEASE_RUNNER_LABELS_MAC --body '["macos-14"]'
```

No workflow YAML change needed; the next workflow run picks up the override.
