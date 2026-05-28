-- v0.9.0 G4 P26 — page lifecycle status + parallel translations.
--
-- Adds three additive columns to `pages` (no data loss):
--   - status text NOT NULL DEFAULT 'published'   (draft|review|published|archived, CHECK-constrained)
--   - translation_of_page_id uuid                (self-FK, ON DELETE SET NULL)
--   - translation_locale text                    (BCP-47 locale string)
--
-- The Drizzle generator can express the column adds + the self-FK + the
-- indexes, but it has no CHECK builder and no atomic-backfill guard, so we
-- hand-augment: the whole sequence runs inside a single DO block (Postgres
-- DDL is transactional, so wrapping in BEGIN/COMMIT gives us all-or-nothing
-- semantics), and a pre-vs-post row count guard refuses the COMMIT if the
-- backfill miscounts (spec §5 risk #4).

BEGIN;

DO $$
DECLARE
  pre_count bigint;
  post_count bigint;
BEGIN
  SELECT count(*) INTO pre_count FROM "pages";

  -- Additive lifecycle columns. Default = 'published' so every existing row
  -- is implicitly backfilled at ADD COLUMN time (Postgres rewrites the rows
  -- lazily; the column is non-null with a default → no NULL rows).
  ALTER TABLE "pages" ADD COLUMN "status" text DEFAULT 'published' NOT NULL;
  ALTER TABLE "pages" ADD COLUMN "translation_of_page_id" uuid;
  ALTER TABLE "pages" ADD COLUMN "translation_locale" text;

  ALTER TABLE "pages"
    ADD CONSTRAINT "pages_translation_of_page_id_pages_id_fk"
    FOREIGN KEY ("translation_of_page_id")
    REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;

  ALTER TABLE "pages"
    ADD CONSTRAINT "pages_status_check"
    CHECK ("status" IN ('draft','review','published','archived'));

  CREATE INDEX "pages_status_idx" ON "pages" USING btree ("status");
  CREATE INDEX "pages_translation_of_idx" ON "pages" USING btree ("translation_of_page_id");

  -- Confirm every existing row landed on 'published' (spec §5 risk #4).
  SELECT count(*) INTO post_count FROM "pages" WHERE "status" = 'published';
  IF post_count <> pre_count THEN
    RAISE EXCEPTION 'page-status backfill miscount: pre=% post=%', pre_count, post_count;
  END IF;
END $$;

COMMIT;
