# CFG-3 — Admin Schedules UI + multi-instance scheduler safety

**Goal** — give operators an admin **Settings → Admin → Schedules** page on
top of the existing in-process cron scheduler, plus make that scheduler
**multi-instance safe** via a Postgres advisory lock and add a **Run now**
affordance. The scheduler, `cron_schedules` table, and `cron-register.ts`
already exist (v0.7.0 P14 / v0.9.0 G2–G8); this item builds the UI + safety
layer on top — it does **not** unify the `setInterval` tickers (digest /
embeddings) into cron rows, and does **not** remove any env knobs.

Scope decision (locked with user): build the admin page, advisory-lock the
poll-and-dispatch with a fixed key distinct from the migrations/backup locks,
and make "Run now" mean **due immediately** (the poller executes it within
≤60 s) — the request path never spawns the CLI, preserving single-runner
semantics.

---

## Data model

No schema change. Operates over the existing `cron_schedules` table
(`src/db/schema/cron-schedules.ts`): `id uuid PK`, `workspace_id uuid NULL`,
`command text`, `cron_spec text`, `next_run_at`, `last_run_at`, `last_status`
(`'success'|'failure'`), `last_error`, `enabled bool`, `created_at`.

## Library — `src/lib/scheduler/manage.ts` (new)

Pure, db-injected, unit-testable.

- `type ScheduleRow` — operator-facing view (ISO-string timestamps, no
  internal-only columns).
- `class InvalidCronError` — thrown on a malformed cron expression (→ 400).
- `nextRunFromCron(cronSpec, now?)` — validate + compute next fire via
  `cron-parser` (UTC, matching `cron-register.ts`); throws `InvalidCronError`.
- `listSchedules(db): Promise<ScheduleRow[]>` — all rows, ordered by command
  then id.
- `updateSchedule(db, id, { cronSpec?, enabled? })` — validate cron BEFORE any
  write; recompute `next_run_at` when `cronSpec` changes. Idempotent (no-field
  call returns the row unchanged). Returns `null` for an unknown id.
- `runScheduleNow(db, id)` — set `next_run_at = now()` so the next poll runs it;
  returns the row (or `null`). Does **not** spawn the CLI.

## Scheduler safety — `src/server/scheduler.ts` (advisory lock)

`startScheduler` gains an optional `lockConnectionString` (default
`process.env.DATABASE_URL`) + `lockKey` (default
`SCHEDULER_ADVISORY_LOCK_KEY = 4021966012`, exported). Each tick:

1. On a **dedicated single-connection** `postgres` client (`max:1` — advisory
   locks are session-scoped, so try-lock and unlock must run on the same
   physical connection), `SELECT pg_try_advisory_lock(<key>)`.
2. If not acquired → another instance is running this tick → **skip**.
3. If acquired → run the existing poll-and-dispatch, then
   `pg_advisory_unlock(<key>)` in a `finally` (also auto-released on process
   death, so a crashed tick never wedges future ticks).

The existing module-scoped re-entry guard is kept (prevents a slow batch
overlapping its own next tick within one process). When no connection string is
available (no `DATABASE_URL`), it degrades to the legacy single-instance path
(re-entry guard only) rather than refusing to run. The key is distinct from the
migrations lock (`4021966011`) and the backup lock (`746450424143`).

## API

- `GET /api/admin/schedules` — `requireRole('admin')` → `{ schedules }`.
- `PATCH /api/admin/schedules/[id]` — `{ cronSpec?, enabled? }` →
  `updateSchedule`; invalid cron → 400; unknown id → 404; audits
  `config.schedule_updated` (target `cron_schedule`, the row uuid).
- `POST /api/admin/schedules/[id]/run` — `runScheduleNow`; unknown id → 404;
  audits `config.schedule_run`.
- `config.schedule_updated` + `config.schedule_run` added to `AUDIT_ACTIONS`;
  `cron_schedule` added to `AuditTargetType`; labels added to the audit-viewer
  exhaustive map.

## UI

- `src/app/(app)/settings/admin/schedules/page.tsx` — server, admin-gated,
  breadcrumb, plain-English h1 ("Scheduled jobs") + description (→ baseline),
  `<SchedulesManager initial={await listSchedules(getDb())} />`.
- `src/components/settings/schedules-manager.tsx` — client: a card per job with
  command + scope (global/workspace), a last-status badge, an editable cron
  expression input, an enable/disable `role="switch"` toggle, a "Run now"
  button, and next/last-run timestamps (luxon `relativeFromNow` +
  `absoluteLocal` on hover). Save via PATCH, run via POST, toggle optimistic +
  rollback, inline status text. A note states the scheduler must be enabled
  (`CAIRN_SCHEDULER_ENABLED=1`) for jobs to run.
- data-testids: `schedules-manager`, `schedules-status`,
  `schedules-enabled-note`, `schedules-empty`, and per-row
  `schedule-row-<id>`, `schedule-cron-<id>`, `schedule-save-<id>`,
  `schedule-enabled-<id>`, `schedule-run-<id>`, `schedule-error-<id>`.
- Nav: `admin-schedules` → `/settings/admin/schedules` under the **operations**
  group (`sidebar.tsx`), above Backups.

## i18n

`settings.nav.admin.schedules` + `schedules.*` (client manager) in
`messages/{en,es,ar}.json` (also backfilled the missing
`settings.nav.admin.email` key from CFG-1). New server-chrome strings (page
h1/description) → `i18n-audit.baseline.json`.

## Docs

`docs/operations.md` "Cron-driven CLI scheduler" section rewritten: documents
the per-tick advisory lock (multi-instance SAFE, exactly-once per tick), the
admin Schedules page + "Run now" semantics, and that one-instance is still the
recommended posture.

## Failure modes verified (spec tests)

- `manage.ts`: list ordering; cron edit recomputes `next_run_at`; invalid cron
  throws + writes nothing; enable/disable; no-field idempotent; unknown id →
  null; `runScheduleNow` sets `next_run_at ≈ now`.
- API: GET 403 non-admin / 401 unauth / admin lists; PATCH updates + audits
  `config.schedule_updated` (target id = row uuid); invalid cron → 400 (no
  write); unknown id → 404; POST run marks due-now + audits
  `config.schedule_run`; POST run 403 non-admin.
- Advisory lock: key distinct from the migrations lock; a held lock makes the
  tick skip (no spawn, row untouched); the lock is acquired-then-released around
  a tick (a fresh session can re-acquire); two concurrent schedulers sharing the
  key process a single due row exactly once.
- Component: renders a row per schedule; edit+save calls PATCH with `{cronSpec}`;
  toggle calls PATCH with `{enabled}` (+ rollback on failure); Run now calls
  POST; empty state.

## Gate

`pnpm typecheck` clean · `pnpm biome check` 0 errors · `pnpm i18n:check` no new ·
new test files green via `pnpm vitest run` · `tests/server src/server` + existing
scheduler test green (no regression). Branch
`release/v0.10.3-item-CFG-3-scheduler-ui` → PR → squash into `release/v0.10.3`.
