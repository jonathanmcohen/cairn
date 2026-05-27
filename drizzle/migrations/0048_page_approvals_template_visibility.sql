-- v0.9.0 G4 P24 — Page approval + signed audit (shared with P25 G4 — template visibility).
--
-- This migration is intentionally atomic across two consumers:
--   1. P24 adds `page_approvals` — a tamper-evident decision log keyed to
--      `pages` + `page_versions` + `users`. Each row carries an HMAC-SHA256
--      signature derived from (page_id|version_snapshot_id|approver_user_id|
--      decision|approved_at_iso) under AUTH_SECRET. The signature is verified
--      by the lifecycle library, not the database — the DB just stores the hex.
--   2. P25 adds `templates.visibility` — a {private,workspace,public} sharing
--      tier consumed by the save-as-template modal and gallery. Default is
--      'workspace' so existing rows match their de-facto sharing tier.
--
-- The whole sequence runs inside a single DO block so the column add + check
-- constraint apply atomically (Postgres DDL is transactional).

BEGIN;

DO $$
DECLARE
  pre_count bigint;
  post_count bigint;
BEGIN
  -- P24: page_approvals
  CREATE TABLE IF NOT EXISTS "page_approvals" (
    "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "page_id"               uuid NOT NULL,
    "version_snapshot_id"   uuid NOT NULL,
    "approver_user_id"      uuid NOT NULL,
    "decision"              text NOT NULL,
    "comment"               text,
    "signature_hmac"        text NOT NULL,
    "approved_at"           timestamp with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "page_approvals"
    ADD CONSTRAINT "page_approvals_page_id_pages_id_fk"
    FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id")
    ON DELETE cascade ON UPDATE no action;

  ALTER TABLE "page_approvals"
    ADD CONSTRAINT "page_approvals_version_snapshot_id_page_versions_id_fk"
    FOREIGN KEY ("version_snapshot_id") REFERENCES "public"."page_versions"("id")
    ON DELETE restrict ON UPDATE no action;

  ALTER TABLE "page_approvals"
    ADD CONSTRAINT "page_approvals_approver_user_id_users_id_fk"
    FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id")
    ON DELETE restrict ON UPDATE no action;

  ALTER TABLE "page_approvals"
    ADD CONSTRAINT "page_approvals_decision_check"
    CHECK ("decision" IN ('approved', 'rejected', 'requested_changes'));

  CREATE INDEX IF NOT EXISTS "page_approvals_page_idx"
    ON "page_approvals" USING btree ("page_id", "approved_at" DESC NULLS LAST);
  CREATE INDEX IF NOT EXISTS "page_approvals_approver_idx"
    ON "page_approvals" USING btree ("approver_user_id");

  -- P25: templates.visibility (column add + check + backfill guard)
  SELECT count(*) INTO pre_count FROM "templates";

  ALTER TABLE "templates"
    ADD COLUMN "visibility" text DEFAULT 'workspace' NOT NULL;

  ALTER TABLE "templates"
    ADD CONSTRAINT "templates_visibility_check"
    CHECK ("visibility" IN ('private', 'workspace', 'public'));

  SELECT count(*) INTO post_count FROM "templates" WHERE "visibility" = 'workspace';
  IF post_count <> pre_count THEN
    RAISE EXCEPTION 'templates.visibility backfill miscount: pre=% post=%', pre_count, post_count;
  END IF;
END $$;

COMMIT;
