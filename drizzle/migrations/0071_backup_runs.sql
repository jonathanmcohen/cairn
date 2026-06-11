-- 0071_backup_runs.sql
-- v0.10.0 C3 — durable backup-run history table. Every CLI `backup` run
-- (manual create-now, cron scheduler tick, or operator shell) inserts a
-- 'running' row before the pg_dump and flips it to 'done'/'failed' after
-- (src/lib/backups/run-history.ts). Hand-written: db:generate emits the
-- table fine but not the CHECK constraints, and recent migrations
-- (0065-0070) are hand-written with a journal entry only.
--
-- A3 lesson: this migration is a NEW EMPTY TABLE only — it does not touch
-- any existing rows or change the behavior of existing tables, so no
-- backfill is needed.
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"bundle_ts" text,
	"error" text,
	"duration_ms" integer,
	CONSTRAINT "backup_runs_status_check" CHECK ("status" IN ('running','done','failed')),
	CONSTRAINT "backup_runs_trigger_check" CHECK ("trigger" IN ('manual','scheduled'))
);
--> statement-breakpoint
CREATE INDEX "backup_runs_started_at_idx" ON "backup_runs" USING btree ("started_at" DESC);
