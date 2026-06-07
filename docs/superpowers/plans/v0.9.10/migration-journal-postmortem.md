# Postmortem — v0.9.9 migration journal-order outage

**Severity:** P0 (upgrade crash-loop, all existing deployments)
**Detection:** operator boot log (`FATAL: 6 pending migration(s)`)
**Fix:** v0.9.10
**Duration live-broken:** v0.9.9 was never serviceable on an upgraded DB; fresh installs unaffected.

## Impact
Any instance upgrading v0.9.8/v0.9.9 → v0.9.9 with migration 0062 already applied crash-looped at boot. The `assertNoPendingMigrations` guard (added in v0.9.9 Plan A) refused to serve a half-migrated DB — working as designed; it surfaced the latent bug rather than silently serving a broken schema.

## Timeline
1. v0.9.9 plans B–M added migrations 0062–0068, each authored by a separate implementer subagent.
2. Subagents hand-stamped journal `when` timestamps (drizzle-kit `db:generate` is a documented broken path in this repo, so journals are hand-maintained).
3. The hand-picked `when` values for 0063–0068 happened to be **earlier** than 0062's (`…597491`).
4. CI passed (fresh-DB only — see below). v0.9.9 shipped.
5. Operator upgrade boot → guard abort.

## Root cause
drizzle's pg migrator (`drizzle-orm/pg-core/dialect.js`) runs each journal entry **iff** `max(applied.created_at) < entry.when`. It tracks only the single highest applied timestamp, not the set of applied migrations. So an entry whose `when` is ≤ an already-applied entry's `when` is **silently skipped**. With 0062's `when` the largest, 0063–0068 (smaller) were skipped on every upgrade.

## Why CI missed it
The Testcontainers harness (`tests/helpers/db.ts`) applies migration `*.sql` files in **filename order**, not via drizzle's `when`-gated `migrate()`. Fresh-DB CI therefore applies all migrations regardless of `when`, so the ordering defect is invisible. The bug only manifests on a real **upgrade** against drizzle's runtime migrator. Classic fresh-vs-upgrade test gap.

## Fix
- Re-stamped 0063–0068 `when` strictly increasing above 0062 (`drizzle/migrations/meta/_journal.json`). No SQL/schema change.
- `tests/lib/upgrade/journal-monotonic.test.ts`: asserts the newest migration holds the global-max `when`, and idx ≥ 62 strictly increases — encodes the exact drizzle invariant.

## Prevention / follow-ups
- **Shipped:** journal-monotonicity unit guard.
- **Consider:** an upgrade-path CI job that runs drizzle's real `migrate()` against a DB pre-seeded to the previous release tag (would have caught this directly).
- **Process:** when hand-stamping journal `when`, always set it to `max(existing) + 1`; never reuse generator defaults out of order. Note added to the migrations gotcha list.

## Grandfathered note
The journal has two older non-monotonic dips (idx 42, and the 0040/0041 round-number inserts) that are already applied in the field and sit below the running max, so they never re-evaluate. Left as-is; the guard enforces monotonicity from idx 62 forward.
