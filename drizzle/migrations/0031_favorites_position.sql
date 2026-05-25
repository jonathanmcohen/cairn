DROP INDEX "user_page_prefs_favorites_idx";--> statement-breakpoint
ALTER TABLE "user_page_prefs" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill: carry forward v0.6's favorite_order where set so the cutover preserves order.
UPDATE "user_page_prefs" SET "position" = COALESCE("favorite_order", 0);--> statement-breakpoint
CREATE INDEX "user_page_prefs_favorites_idx" ON "user_page_prefs" USING btree ("user_id","workspace_id","favorite","position");