CREATE TABLE "siem_delivery_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"forwarder_id" uuid NOT NULL,
	"audit_event_id" uuid NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error" text,
	"next_attempt_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "siem_forwarders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"endpoint" text NOT NULL,
	"credential_secret" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "siem_delivery_log" ADD CONSTRAINT "siem_delivery_log_forwarder_id_siem_forwarders_id_fk" FOREIGN KEY ("forwarder_id") REFERENCES "public"."siem_forwarders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_delivery_log" ADD CONSTRAINT "siem_delivery_log_audit_event_id_audit_log_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siem_forwarders" ADD CONSTRAINT "siem_forwarders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "siem_delivery_log_forwarder_idx" ON "siem_delivery_log" USING btree ("forwarder_id");--> statement-breakpoint
CREATE INDEX "siem_forwarders_workspace_idx" ON "siem_forwarders" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "siem_forwarders_enabled_idx" ON "siem_forwarders" USING btree ("workspace_id","enabled");--> statement-breakpoint
-- v0.9.0 G8 P39 — Restrict `kind` to the known forwarder shapes + `status`
-- to the known delivery outcomes. Drizzle 0.45 doesn't emit CHECK constraints
-- (CLAUDE.md "Gotchas: db:generate doesn't emit extensions/triggers/self-FKs"),
-- so we append them here. P40 layers `splunk_hec` + `datadog` + `s3` targets
-- onto the same scaffold.
ALTER TABLE "siem_forwarders" ADD CONSTRAINT "siem_forwarders_kind_check"
  CHECK ("kind" IN ('syslog','http','splunk_hec','datadog','s3'));--> statement-breakpoint
ALTER TABLE "siem_delivery_log" ADD CONSTRAINT "siem_delivery_log_status_check"
  CHECK ("status" IN ('success','retry','failed'));--> statement-breakpoint
-- Partial index on retry rows only — the cron sweep selects
-- `status='retry' AND next_attempt_at <= now()` every 60s.
CREATE INDEX "siem_delivery_log_retry_idx" ON "siem_delivery_log"
  USING btree ("status","next_attempt_at") WHERE "status" = 'retry';