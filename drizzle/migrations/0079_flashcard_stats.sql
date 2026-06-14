-- 0079_flashcard_stats.sql
-- v0.10.2 F3 Task A — flashcard stats/settings/leech data foundation.
--
-- 1. `flashcard_review_events` — append-only review event log. One row per
--    (card, user, review). Used for time-windowed stats, streak calculation,
--    and leech detection (grade=0 count ≥ leech_threshold).
--
-- 2. `workspace_flashcard_settings` — one row per workspace with schedule
--    defaults and leech/reminder configuration. NULL columns inherit the
--    application defaults documented in src/lib/flashcards/settings.ts.
--
-- Hand-written (db:generate does NOT emit triggers/self-FKs or idempotent
-- guards). IDEMPOTENT: all DDL uses IF NOT EXISTS.

-- 1. flashcard_review_events
CREATE TABLE IF NOT EXISTS "flashcard_review_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "grade" integer NOT NULL,
  "reviewed_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'flashcard_review_events_card_id_flashcard_cards_id_fk'
  ) THEN
    ALTER TABLE "flashcard_review_events"
      ADD CONSTRAINT "flashcard_review_events_card_id_flashcard_cards_id_fk"
      FOREIGN KEY ("card_id") REFERENCES "public"."flashcard_cards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'flashcard_review_events_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "flashcard_review_events"
      ADD CONSTRAINT "flashcard_review_events_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

-- Index for time-window stats queries (e.g. reviews in last 30 days for a user).
CREATE INDEX IF NOT EXISTS "flashcard_review_events_user_reviewed_at_idx"
  ON "flashcard_review_events" ("user_id", "reviewed_at");
--> statement-breakpoint

-- Index for leech detection (count Again grades per card+user).
CREATE INDEX IF NOT EXISTS "flashcard_review_events_card_user_idx"
  ON "flashcard_review_events" ("card_id", "user_id");
--> statement-breakpoint

-- 2. workspace_flashcard_settings
CREATE TABLE IF NOT EXISTS "workspace_flashcard_settings" (
  "workspace_id" uuid PRIMARY KEY NOT NULL,
  "default_deck_id" uuid,
  "new_per_day" integer NOT NULL DEFAULT 20,
  "review_limit" integer NOT NULL DEFAULT 200,
  "ease_start" real NOT NULL DEFAULT 2.5,
  "leech_threshold" integer NOT NULL DEFAULT 8,
  "reminder_hour" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'workspace_flashcard_settings_workspace_id_workspaces_id_fk'
  ) THEN
    ALTER TABLE "workspace_flashcard_settings"
      ADD CONSTRAINT "workspace_flashcard_settings_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'workspace_flashcard_settings_default_deck_id_flashcard_decks_id_fk'
  ) THEN
    ALTER TABLE "workspace_flashcard_settings"
      ADD CONSTRAINT "workspace_flashcard_settings_default_deck_id_flashcard_decks_id_fk"
      FOREIGN KEY ("default_deck_id") REFERENCES "public"."flashcard_decks"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
