-- v0.9.0 G1 P9 — PAT quotas + scope rate-limits
-- Adds three nullable quota columns to personal_access_tokens and the
-- pat_quota_usage rollup table keyed by (token_id, window_start, window_kind).

ALTER TABLE "personal_access_tokens"
  ADD COLUMN "daily_request_limit" integer,
  ADD COLUMN "monthly_request_limit" integer,
  ADD COLUMN "scope_rate_limits" jsonb;
--> statement-breakpoint
CREATE TABLE "pat_quota_usage" (
  "token_id" uuid NOT NULL,
  "window_start" timestamptz NOT NULL,
  "window_kind" text NOT NULL,
  "requests" integer NOT NULL DEFAULT 0,
  "bytes" bigint NOT NULL DEFAULT 0,
  CONSTRAINT "pat_quota_usage_pk" PRIMARY KEY ("token_id", "window_start", "window_kind"),
  CONSTRAINT "pat_quota_usage_window_kind_chk" CHECK ("window_kind" IN ('day', 'month'))
);
--> statement-breakpoint
ALTER TABLE "pat_quota_usage"
  ADD CONSTRAINT "pat_quota_usage_token_id_fk"
  FOREIGN KEY ("token_id") REFERENCES "personal_access_tokens"("id") ON DELETE CASCADE;
