-- v0.9.0 G5 P29 — Search operators parser + chip UI + saved templates.
--
-- Extends the existing `saved_searches` table (v0.6 P22) with a nullable
-- `template_name text` column. A row is a saved-search when `template_name IS
-- NULL` and an operator template when set. Templates store their expansion
-- string in the existing `query` column — no schema duplication.
--
-- The partial unique index enforces "one template per name per (workspace,
-- user)" without affecting plain saved-search rows (which always have
-- template_name NULL and can therefore coexist).

ALTER TABLE "saved_searches" ADD COLUMN "template_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_searches_template_name_uq" ON "saved_searches" USING btree ("workspace_id","user_id","template_name") WHERE "saved_searches"."template_name" IS NOT NULL;
