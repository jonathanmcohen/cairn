# Post-mortem — `workspaces.icon` 42703 on the homelab (reported as "v0.9.15.1")

**Date:** 2026-06-09
**Severity:** P1 (workspace list / switcher unusable on the affected deployment)
**Status:** Resolved by redeploying the current image (no code/migration change needed).

## Symptom

The homelab container logged, on every workspace-list / workspace-detail load:

```
⨯ Error: Failed query: select "workspaces"."id", "workspaces"."name",
  "workspace_members"."role", "workspaces"."icon" ...
code: '42703', cause: column workspaces.icon does not exist
```

This manifested as two user-visible bugs:
- **#142** — workspace icon save "does nothing" (the server query throws before the icon can round-trip).
- **#143** — workspace switch leaves the sidebar stale (`/api/v1/workspaces` throws on every refetch, so the client caches never resolve to fresh data).

## Initial (incorrect) hypothesis

The triage note proposed: *"the `workspaces.icon` column migration was never added"* — i.e. a feature PR shipped the icon UI + queries but forgot the migration — and recommended cutting **v0.9.15.1** with `ALTER TABLE workspaces ADD COLUMN icon text`.

## Actual root cause

The source was **never** missing the migration. Ground-truth at the time of the report:

- `drizzle/migrations/0054_workspace_icon.sql` exists: `ALTER TABLE "workspaces" ADD COLUMN "icon" text;` (shipped **v0.9.4**, UX audit #81).
- It is registered in `drizzle/migrations/meta/_journal.json` (idx 55).
- `src/db/schema/workspaces.ts` already declares `icon: text('icon')`.

So the column **is** created by migration 0054, which ships inside every image ≥ v0.9.4. The live `42703` means the **deployed database never had 0054 applied** — a **stale / un-migrated deployment**, not a source defect.

This is the *same* incident class as the original **v0.9.4 → v0.9.5** outage. Its fix is documented inline in `src/db/migrate.ts:18-32`:

> *"A cwd-relative `./drizzle/migrations` silently resolves to an empty/nonexistent folder when the container's standalone server is started from any directory other than the image WORKDIR — drizzle's migrator then finds zero pending migrations, prints success, and skips the schema change entirely (v0.9.4 homelab outage: `workspaces.icon` never created … 42703)."*

That fix (a) resolves the migrations folder **absolutely** from the module's location, and (b) calls `assertNoPendingMigrations()` after `migrate()` so a half-migrated DB now **fails the boot loudly** (non-zero exit) instead of serving a broken schema. Both have been in the image since v0.9.5.

### Why the duplicate-migration hotfix was rejected

Cutting v0.9.15.1 with another `ALTER TABLE workspaces ADD COLUMN icon text` would have:
1. Thrown `column "icon" already exists` and **bricked boot on every database that already ran 0054** (i.e. all healthy deployments).
2. Required a hand-authored, duplicate journal entry (`db:generate` emits nothing — the column is already in `schema.ts`), creating journal drift.
3. Failed to help the broken host anyway: if that host's *deployed* migrator is the old pre-v0.9.5 one that silently skips, a *new* migration runs through the *same* broken migrator and is skipped too.

## Resolution

Redeploy the current image (v0.9.16, which bundles 0054→0069 **and** the fail-loud migrator). On boot it takes the migration advisory lock, applies the pending migrations, creates `workspaces.icon`, and passes `assertNoPendingMigrations`. #142 and #143 resolve once `/api/v1/workspaces` stops throwing.

Immediate stopgap if a redeploy is not possible: `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS icon text;` directly on the live DB (idempotent; does not touch `migrations/` or the journal).

## Detection gap

The bad schema only surfaced at **runtime** on the affected host, via the workspace switcher. There was no signal at build/CI/deploy time because:
- The source was correct, so no schema↔migration drift existed to catch.
- The loud-migrator guard (`assertNoPendingMigrations`) **does** catch this at boot — but only on a host actually running the ≥ v0.9.5 image. The broken host was running an older/un-migrated state.

## Prevention

1. **Schema ↔ migrations drift guard (added).** `tests/db/schema/schema-migration-drift.test.ts` runs every migration on a fresh Testcontainers Postgres, then issues a zero-row `SELECT` of all columns for every `pgTable` exported from `src/db/schema`. A column present in `schema.ts` but created by no migration raises 42703 and fails CI. This guards the class of bug originally *suspected* here (schema column without a migration), inside the existing `db` CI matrix job — no new workflow.
2. **Boot-time guard (already shipped, v0.9.5).** `assertNoPendingMigrations()` turns a trailing DB into a loud boot failure. Operators upgrading from a pre-v0.9.5 image get a hard error instead of silent 42703s — provided they deploy the current image.
3. **Operational follow-up.** Ensure the homelab deploy always pulls the tagged image (not a stale local one) and that the entrypoint migrator runs; consider surfacing the applied-migrations head in `/healthz` so deploy verification can assert DB == bundled journal.

## Timeline

- **v0.9.4** — `workspaces.icon` + migration 0054 shipped.
- **v0.9.4→v0.9.5** — first 42703 outage (cwd-relative migrations folder → silent skip); fixed with absolute-path resolution + `assertNoPendingMigrations`.
- **v0.9.15** — icon picker UI + switcher badge + list-query projection added; all correct against schema + 0054.
- **2026-06-09** — homelab re-reports 42703. Diagnosed as a stale/un-migrated deployment, not a source regression. Resolved by redeploy. Drift guard added as belt-and-suspenders.
