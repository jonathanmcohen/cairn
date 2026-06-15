# Plan CFG — surface env-only configuration into the UI

> **HOLD: do not touch code until the user replies GO on Plan A11Y (then CFG).** Scaffold only.
> REQUIRED SUB-SKILL at execution: superpowers:subagent-driven-development.

**Goal** — SMTP, S3, and the scheduler currently require env vars. Make them
configurable from Settings. **DB values override env; existing env migrates in
on first boot.** Secret fields are write-once / never re-displayed, encrypted at
rest (standing security rule). Fail-closed on config errors.

---

### CFG-1 — Settings → Workspace → Email (NEW)

- Fields: SMTP host, port, username, **password (write-once)**, from-address,
  reply-to, TLS mode (STARTTLS / TLS / none).
- **"Send test email"** → sends to the current user; surfaces success / SMTP
  error code.
- First-boot migrate of existing `SMTP_*` env → row; **UI overrides env**.
- The Notifications "email disabled — no SMTP configured" banner links here.
- Migration: workspace email-config table (number TBD at lock, ~0082).
- Spec: e2e round-trip (save → read-back masks secret → test-send path) + the banner link.

### CFG-2 — Settings → Admin → Storage (NEW)

- S3-compatible config consumed by: workspace-archive backups, uploaded-file
  offload, SIEM `s3` sink, Anki `.apkg` cache.
- Fields: provider (S3 / R2 / MinIO / Backblaze B2), endpoint, region, bucket,
  access key, **secret key (write-once)**, path prefix, public-bucket toggle.
- **"Test connection"** → small `PutObject` + `DeleteObject`; reports
  success / 4xx / 5xx + response body.
- Each consumer (Backups / File uploads / SIEM s3) opts in via a checkbox —
  **default off until tested**.
- First-boot migrate of existing `S3_*` env; UI overrides env.
- Migration: storage-config table (number TBD at lock, ~0083).
- Spec: e2e save + test-connection (mock S3) + per-consumer opt-in gating.

### CFG-3 — In-package scheduler (remove env requirement)

- Bundle a cron-like runner inside the Cairn process; schedules persisted in
  **`scheduled_jobs` (migration 0081)**, survive restarts.
- Settings → Workspace → **Schedules (NEW)**: lists every workspace job
  (Flashcards reminder, Trash auto-purge, Static-site export refresh, Workspace
  archive cron, …) with next run, last run + outcome, editable cron expression,
  enable/disable, **run now**.
- Remove `CAIRN_SCHEDULER_*` env reliance — values live in the DB.
- **Multi-instance caveat:** the existing in-process tickers are single-instance
  only (double-fire risk). Carry that constraint forward — document it on the
  Schedules page; advisory-lock or single-runner election is the safe path
  (resolve approach at GO).
- Spec: e2e create/edit/disable/run-now a job; integration test that a persisted
  schedule fires after a simulated restart.

### CFG-4 — Config doctor / System health (NEW)

- Settings → Admin → **System health** aggregates every "disabled/degraded"
  indicator currently scattered (Yjs-bridge toolbar pill, SMTP-off Notifications
  banner, E2E-disabled Encryption banner) into one page with a **Fix** link to
  the right settings page.
- Status pills: SMTP (configured / not / test-failed) · S3 (off / configured /
  unreachable) · Yjs bridge (live / degraded) · E2E (on / off) · Scheduler
  (running / paused) · Search index (healthy / indexing N).
- Spec: e2e renders all pills + each Fix link routes to its settings page.

---

## Failure modes to verify

- **DB config absent, env present** → env still works (migrate-in path). (spec)
- **Secret re-display leak** → GET never returns the stored SMTP password / S3
  secret; UI shows a masked "set" state only. (spec — security)
- **Test-send / test-connection failure** → surfaced verbatim (SMTP code / S3
  status+body), config NOT marked healthy. (spec)
- **Scheduler double-fire** under >1 instance → documented + guarded. (spec/doc)
- **Consumer opts in before a successful test** → blocked (default off). (spec)

## Coverage check (fill at lock)

| Deliverable | Build item | Spec |
|---|---|---|
| Email settings + test-send + banner link | CFG-1 | _TBD_ |
| Storage settings + test-connection + opt-ins | CFG-2 | _TBD_ |
| scheduled_jobs + Schedules page + run-now | CFG-3 | _TBD_ |
| System health aggregation + Fix links | CFG-4 | _TBD_ |

## Failure-modes-verified (fill at lock)

- [ ] env→DB migrate-in (CFG-1/2)
- [ ] secret never re-displayed (CFG-1/2)
- [ ] test failure surfaced + not-healthy (CFG-1/2)
- [ ] scheduler single-instance guard (CFG-3)
- [ ] consumer opt-in gated on passing test (CFG-2)

## Open questions for GO

- Migration numbers for CFG-1/CFG-2 tables (0082/0083 vs interleave).
- Scheduler engine: `node-cron` dep vs hand-rolled; single-runner election
  mechanism (advisory lock?) for the multi-instance caveat.
- Are SMTP/storage config **per-workspace** or **instance-global**? (CFG-1 says
  Workspace → Email; CFG-2 says Admin → Storage — confirm scoping per feature.)
- Encryption key for secrets-at-rest (reuse `AUTH_SECRET`-derived or a dedicated key).
