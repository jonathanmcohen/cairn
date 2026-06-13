-- 0077_flashcards_manage.sql
-- v0.10.2 F1 — flashcards management layer (Task A: data layer).
--
-- Adds a first-class `flashcard_decks` table, deck/tag/suspend/orphan columns
-- on `flashcard_cards`, and a `reps` counter on `flashcard_reviews`. Flips the
-- card→page FK from ON DELETE CASCADE to ON DELETE SET NULL so permanently
-- deleting a page ORPHANS its cards (preserving review history) rather than
-- destroying them.
--
-- Hand-written (db:generate does NOT emit FK-semantic flips, seeds, or
-- backfills). IDEMPOTENT where practical: new columns/tables ride on
-- IF NOT EXISTS; seed/backfill UPDATEs are guarded so a re-run is a no-op.

-- 1. NEW TABLE: flashcard_decks (minimal — one named deck per workspace).
CREATE TABLE IF NOT EXISTS "flashcard_decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flashcard_decks_workspace_id_name_unique" UNIQUE ("workspace_id", "name")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "flashcard_decks" ADD CONSTRAINT "flashcard_decks_workspace_id_workspaces_id_fk"
		FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- 2. SEED: one "Default" deck per existing workspace (skip if it already exists).
INSERT INTO "flashcard_decks" ("workspace_id", "name")
SELECT w."id", 'Default'
FROM "workspaces" w
ON CONFLICT ("workspace_id", "name") DO NOTHING;
--> statement-breakpoint

-- 3. BACKFILL: a deck per distinct existing flashcard_cards.deck_tag
--    (non-null, per workspace) by name. ON CONFLICT no-ops if the name
--    already exists (e.g. a deck_tag literally named 'Default').
INSERT INTO "flashcard_decks" ("workspace_id", "name")
SELECT DISTINCT c."workspace_id", c."deck_tag"
FROM "flashcard_cards" c
WHERE c."deck_tag" IS NOT NULL
ON CONFLICT ("workspace_id", "name") DO NOTHING;
--> statement-breakpoint

-- 4. NEW COLUMNS on flashcard_cards.
ALTER TABLE "flashcard_cards" ADD COLUMN IF NOT EXISTS "deck_id" uuid;
--> statement-breakpoint
ALTER TABLE "flashcard_cards" ADD COLUMN IF NOT EXISTS "source_orphaned_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "flashcard_cards" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "flashcard_cards" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "flashcard_cards" ADD CONSTRAINT "flashcard_cards_deck_id_flashcard_decks_id_fk"
		FOREIGN KEY ("deck_id") REFERENCES "public"."flashcard_decks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- 5. BACKFILL deck_id: match the card's deck_tag to a deck of the same name in
--    the same workspace; otherwise fall back to that workspace's "Default"
--    deck. Guarded by deck_id IS NULL so a re-run cannot clobber user moves.
UPDATE "flashcard_cards" c
SET "deck_id" = COALESCE(
	(SELECT d."id" FROM "flashcard_decks" d
	  WHERE d."workspace_id" = c."workspace_id" AND d."name" = c."deck_tag"),
	(SELECT d2."id" FROM "flashcard_decks" d2
	  WHERE d2."workspace_id" = c."workspace_id" AND d2."name" = 'Default')
)
WHERE c."deck_id" IS NULL;
--> statement-breakpoint

-- 6. FK SEMANTICS FLIP on flashcard_cards.page_id: NOT NULL → NULLABLE, and the
--    FK from ON DELETE CASCADE → ON DELETE SET NULL. Permanently deleting a
--    page now orphans its cards (page_id → NULL) instead of cascade-deleting
--    them, preserving per-user review history.
ALTER TABLE "flashcard_cards" ALTER COLUMN "page_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "flashcard_cards" DROP CONSTRAINT IF EXISTS "flashcard_cards_page_id_pages_id_fk";
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "flashcard_cards" ADD CONSTRAINT "flashcard_cards_page_id_pages_id_fk"
		FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- 7. NEW COLUMN on flashcard_reviews: reps counter. Backfill 0 (true historical
--    repetition count is unrecoverable for pre-0077 rows).
ALTER TABLE "flashcard_reviews" ADD COLUMN IF NOT EXISTS "reps" integer DEFAULT 0 NOT NULL;
