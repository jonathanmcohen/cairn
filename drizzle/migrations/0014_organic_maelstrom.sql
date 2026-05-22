ALTER TABLE "pages" ADD COLUMN "link_password_hash" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "allow_duplication" boolean DEFAULT false NOT NULL;