# v0.9.10 Scope — Migration journal-order hotfix

Patch release. Single fix; shipped + tagged `v0.9.10`.

## Problem
v0.9.9 crash-looped on upgrade for any DB that already had migration 0062 applied:

```
FATAL: 6 pending migration(s) after migrate() — the database is half-migrated
(first pending: 0063_db_row_body). Refusing to serve a half-migrated database.
```

## Cause
The hand-stamped journal `when` timestamps for migrations **0063–0068 were earlier than 0062's**. drizzle's migrator runs an entry only when `max(applied.created_at) < entry.when`, so once 0062 (the highest `when`) was applied, 0063–0068 were silently skipped. The boot-time `assertNoPendingMigrations` guard (added in v0.9.9 Plan A) then correctly refused to serve.

Fresh installs were unaffected — the Testcontainers harness applies `*.sql` in **filename order**, never exercising drizzle's `when`-gated upgrade path, so CI never caught it.

## Fix
- Re-stamped 0063–0068 `when` strictly increasing above 0062 (`…597492`–`…597497`). **No SQL/schema change** — only ordering metadata.
- Added `tests/lib/upgrade/journal-monotonic.test.ts`: asserts the newest migration holds the global-max `when` and idx ≥ 62 strictly increases. Prevents recurrence.
- Bumped 0.9.9 → 0.9.10.

## Operators
Redeploy `ghcr.io/jonathanmcohen/cairn:v0.9.10`; the entrypoint migrator applies 0063–0068 on boot. No manual DB steps.

Full root-cause writeup: [migration-journal-postmortem.md](migration-journal-postmortem.md).
