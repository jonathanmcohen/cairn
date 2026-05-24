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

Both `.github/workflows/ci.yml` and `.github/workflows/release.yml` run on
GitHub-hosted runners — `ubuntu-latest` for CI + amd64 release build,
`ubuntu-24.04-arm` for the arm64 release build. The arm64 runner is native
(no QEMU emulation, which deadlocked the heavier image on x64). Multi-arch
manifest merge + the GitHub Release step run on `ubuntu-latest`.

There is no self-hosted-runner support in either workflow.
