ALTER TABLE "pages" ADD COLUMN "encrypted_under_wsk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "e2e_mode" text DEFAULT 'off' NOT NULL;