-- 0073_oauth_token_family.sql
-- v0.10.0 G3 — refresh-token family lineage for reuse detection.
--
-- Adds `oauth_tokens.family_id` so every rotation chain descended from one
-- authorization-code grant shares a single family id. When an already-rotated
-- (revoked) refresh token is presented again, the exchange revokes the ENTIRE
-- family in one UPDATE — no lineage walk (src/lib/oauth/exchange.ts).
--
-- Backfill: every EXISTING row gets its OWN fresh family. Pre-migration rows
-- have unknown lineage — grouping them (e.g. by user+client+workspace) would
-- create false-positive blast radius where one reuse kills unrelated live
-- grants (the A3 backfill lesson). A fresh per-row family means a backfilled
-- token's reuse revokes exactly that one row's chain going forward.
--
-- New inserts that don't specify family_id get a fresh family via the column
-- DEFAULT — correct for brand-new authorization-code grants. The rotation
-- insert copies the old row's family_id explicitly.
--
-- IDEMPOTENT by design (a spec re-applies this file to prove it): ADD COLUMN
-- IF NOT EXISTS, backfill guarded by WHERE family_id IS NULL (0 rows on
-- re-apply), SET NOT NULL / SET DEFAULT are no-ops on re-apply, CREATE INDEX
-- IF NOT EXISTS.
ALTER TABLE "oauth_tokens" ADD COLUMN IF NOT EXISTS "family_id" uuid;
--> statement-breakpoint
UPDATE "oauth_tokens" SET "family_id" = gen_random_uuid() WHERE "family_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "oauth_tokens" ALTER COLUMN "family_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "oauth_tokens" ALTER COLUMN "family_id" SET DEFAULT gen_random_uuid();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_tokens_family_idx" ON "oauth_tokens" USING btree ("family_id");
