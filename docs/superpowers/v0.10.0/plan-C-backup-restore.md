# Plan C — backup & restore (primary v0.10 deliverable)

> **HOLD until GO.**

The engine exists and is CLI-only: `src/server/cli.ts:82 backup()` (pg_dump
custom format + uploads tar + `manifest.json` {version, createdAt, fileBackend,
database, encrypted}), AES-256-GCM encryption when
`CAIRN_BACKUP_ENCRYPTION_PASSPHRASE` is set (`src/lib/backups/encryption.ts`,
envelope `CAIRN-ENC-BAK-v1`, Argon2id), `restore()` at `cli.ts:205`
(pg_restore `--clean --if-exists --no-owner`, destructive-confirm gate),
`--target local|s3`, `--retention-days` age-pruning, round-trip tested in
`src/server/__tests__/cli-backup.test.ts`. **Zero web surface**: no
`/api/admin/backups` routes, no admin page, no nav entry
(`src/components/settings/sidebar.tsx:35-92` has no Backups child).

Shared constraints discovered by the re-audit (every C item must respect):

- `FileStorage` has **no `list()`** (`src/lib/files/s3-storage.ts:33-70`
  implements put/exists/delete/read — no list) → snapshot listing needs a
  manifest index or a storage-list extension.
- `pg_dump`/`pg_restore` binaries: present in the runner image; any
  in-process invocation must verify availability and match server major.
- Long dumps cannot run synchronously in a request handler → job pattern
  (row + background spawn, like the scheduler) with status polling.
- Dumps contain password/API-key hashes (`cli.ts:144` warning) → owner/admin
  gating + no unauthenticated download URLs.

## C1 — Backup snapshot UI (seed 3) — Backend-exists-no-UI

Admin → Backups: snapshot list (size, created-at, app version, encrypted flag —
all from `manifest.json`) + "Create snapshot now".

**Build:** `/api/admin/backups` (GET list from manifest index; POST create-now
spawning the existing `backup()` path as a job), Backups admin page, settings
sidebar entry, i18n (en/es/ar).

**Failure modes verified:**
- Create-now from the web process where `pg_dump` is missing/major-mismatched
  → friendly error, not a hung job (spec stubs the spawn).
- GET list after a known backup returns ≥1 entry (catches the no-`list()` trap
  returning silently empty).
- Multi-second dump → request returns a job id immediately; status polled
  (spec asserts non-blocking).
- Viewer/editor → 403 on every backups route; only owner/admin (tenant +
  role spec).

## C2 — Restore UI (seed 4) — Backend-exists-no-UI (+ two net-new pieces)

Upload a bundle (.dump/.tar.gz/.enc) or pick an existing snapshot → confirm
modal → restore-in-place with an app-wide read-only/maintenance mode.

**Honest scoping from the re-audit:** the *restore execution* exists
(`cli.ts:205`); the **confirm-modal "diff summary" and the read-only mode are
net-new** (no snapshot-vs-DB comparison exists anywhere; no app-wide read-only
mode exists). Scope the modal to what is real without new computation: the
snapshot's manifest (version/createdAt/database) + a retype-to-confirm gate
mirroring the CLI's `confirmDestructive`. A row-count diff is OUT of C2 — it
lands with C4 (selective restore, this release), which builds the
scratch-schema machinery that makes snapshot-vs-DB comparison cheap.

**Failure modes verified:**
- Restore starts only after the app enters read-only (writes 503 with a banner;
  spec asserts a write is refused mid-restore).
- Encrypted `.enc` upload with passphrase unset in the web process → upfront
  400 with the exact env name, not a post-upload 500 (`cli.ts:233-236` class).
- Junk/plain-SQL upload → graceful validation error, never a half-applied
  restore (custom-format sniff before pg_restore).
- Confirm modal requires retyping the database name (parity with the CLI gate);
  Cancel leaves the DB untouched (spec asserts row counts unchanged).

## C3 — Scheduled backups (seed 5) — Backend-stub

The substrate runs arbitrary CLI commands on a schedule
(`cron_schedules` table — command/cron_spec/next_run_at/last_run_at/
last_status/last_error/enabled — and `src/server/scheduler.ts:29` spawning
`node dist/server/cli.js <command>`, gated by `CAIRN_SCHEDULER_ENABLED`), and
the schema comment even anticipates `'backup --target s3 --retention-days 14'`
— but **no code path ever creates a backup schedule row**
(`cron-register.ts` registers only trash/auto-unlock/flashcards/siem/
release-watch), retention is age-based only (no keep-N), and there is no
editor UI nor any run **history** (the table holds a single last_run).

**Build:** schedule editor (daily/weekly/custom cron, target local|S3,
retention), a `backup_runs` history table (migration — the single
`last_run_at/_status` column cannot represent history), keep-N retention in
`pruneBundles`, status dashboard (last/next run + history), and validation
that a schedule row always carries `--out` (the CLI throws without it,
`cli-internal.ts:180`).

**Failure modes verified:**
- Schedule created without `--out` → rejected at the API, not a silently
  failing cron (the audit's exact trap).
- keep-N=3 then 5 runs → exactly 3 bundles remain (fails today — no keep-N
  code; the spec is the falsifiable proof the feature landed).
- Dashboard shows ≥2 past runs after 2 ticks (fails today — proves the
  history table, not the single-column stub).
- `CAIRN_SCHEDULER_ENABLED` unset → dashboard surfaces "scheduler not running"
  instead of a silently never-firing schedule (the trash-cron lesson, seed 22).
- Multi-instance double-fire is documented + the runner takes a pg advisory
  lock so two pods cannot run the same backup concurrently.

## C4 — Selective restore (seed 6) — Net-new (in scope per user decision)

Page- or workspace-level restore from a snapshot **without** full DB clobber:
pick a page (with subtree) or a workspace from a snapshot, restore into a
target workspace.

**Approach (locks the design):** `pg_restore` the snapshot into a **scratch
schema** (`restore_tmp_<jobid>`), extract the selected page subtree / workspace
rows, remap primary keys + FKs (new UUIDs; `parent_id` self-FK, `databases` /
`db_rows` / `files` / `comments` chains), insert into the live workspace via
the app's real creators (the seed-faithfulness rule), then drop the scratch
schema. Conflicts: restored pages always get NEW ids — never overwrite a live
row. Yjs: regenerate `page_yjs.state` from the restored `pages.content`
(the established `prosemirrorJSONToYDoc` seed path).

**Builds on:** C1 list/manifest, C2 upload + job pattern. Ships last in Plan C.

**Failure modes verified:**
- Restore a page subtree into a workspace that already has a page with the
  same title → both exist, no overwrite (spec asserts row counts +2, original
  untouched).
- FK remap completeness: restored page with an inline database + rows + files
  round-trips openable in the editor (the deepest-chain spec).
- Cross-tenant: selecting workspace A's page from a snapshot and restoring
  into workspace B requires admin of B; the restored rows carry B's
  workspace_id everywhere (tenant-isolation spec greps the inserted rows).
- Scratch schema is dropped on success AND on failure (spec kills the job
  mid-restore, asserts no `restore_tmp_*` schema remains).
- Snapshot from an OLDER schema version → migration-aware guard: refuse with a
  clear error naming the versions (no silent half-restore).
