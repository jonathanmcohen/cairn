-- v0.9.0 G2 P13 — Workspace settings batch.
-- Three trivial column additions on `workspaces` batched into one migration so
-- P26 (page lifecycle) and P30 (federated search) can land without burning two
-- more migration slots:
--
--   * trash_retention_days   — P13 consumes (auto-purge cron cutoff). 0 = never auto-purge.
--   * default_page_status    — P26 consumes (page lifecycle states).
--   * enable_federated_search — P30 consumes (peer-instance search routing).
--
-- All three NOT NULL with defaults, so existing rows backfill automatically.

ALTER TABLE "workspaces" ADD COLUMN "trash_retention_days" integer DEFAULT 30 NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "default_page_status" text DEFAULT 'published' NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "enable_federated_search" boolean DEFAULT false NOT NULL;
