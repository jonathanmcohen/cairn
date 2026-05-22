ALTER TABLE "workspaces" ADD COLUMN "public_site_slug" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "public_site_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_public_site_slug_unique" UNIQUE("public_site_slug");