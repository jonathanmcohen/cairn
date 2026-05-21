ALTER TABLE "users" ADD COLUMN "email_verified" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "public_slug" text;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_public_slug_unique" UNIQUE("public_slug");