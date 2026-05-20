CREATE TABLE IF NOT EXISTS "system_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pages_title_trgm_idx" ON "pages" USING gin (title gin_trgm_ops);
