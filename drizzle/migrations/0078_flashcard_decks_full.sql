-- 0078_flashcard_decks_full.sql
-- v0.10.2 F2 Task A — extend flashcard_decks with hierarchy + schedule columns.
--
-- Adds six NULLable columns to `flashcard_decks`:
--   icon, color, parent_deck_id (self-FK), default_new_per_day,
--   default_review_limit, ease_start.
-- All columns are additive (no backfill needed; NULL means "inherit workspace
-- default"). IDEMPOTENT: columns use IF NOT EXISTS; the constraint is guarded
-- via a DO $$ block querying pg_constraint.

-- 1. icon — prefix-encoded "emoji::…"/"file::…" like pages.icon.
ALTER TABLE "flashcard_decks" ADD COLUMN IF NOT EXISTS "icon" text;
--> statement-breakpoint

-- 2. color
ALTER TABLE "flashcard_decks" ADD COLUMN IF NOT EXISTS "color" text;
--> statement-breakpoint

-- 3. parent_deck_id — self-FK for nested deck tree.
ALTER TABLE "flashcard_decks" ADD COLUMN IF NOT EXISTS "parent_deck_id" uuid;
--> statement-breakpoint

-- 4. default_new_per_day — per-deck override for new-cards-per-day cap.
ALTER TABLE "flashcard_decks" ADD COLUMN IF NOT EXISTS "default_new_per_day" integer;
--> statement-breakpoint

-- 5. default_review_limit — per-deck override for daily review cap.
ALTER TABLE "flashcard_decks" ADD COLUMN IF NOT EXISTS "default_review_limit" integer;
--> statement-breakpoint

-- 6. ease_start — initial ease factor for new cards in this deck.
ALTER TABLE "flashcard_decks" ADD COLUMN IF NOT EXISTS "ease_start" real;
--> statement-breakpoint

-- 7. Self-FK constraint (no IF NOT EXISTS for ADD CONSTRAINT; guard with DO $$).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'flashcard_decks_parent_deck_id_flashcard_decks_id_fk'
  ) THEN
    ALTER TABLE "flashcard_decks"
      ADD CONSTRAINT "flashcard_decks_parent_deck_id_flashcard_decks_id_fk"
      FOREIGN KEY ("parent_deck_id") REFERENCES "public"."flashcard_decks"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

-- 8. Index on parent_deck_id for tree traversal queries.
CREATE INDEX IF NOT EXISTS "flashcard_decks_parent_deck_id_idx" ON "flashcard_decks" ("parent_deck_id");
