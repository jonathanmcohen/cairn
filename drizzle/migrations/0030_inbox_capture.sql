ALTER TABLE "pages" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "inbox_page_id" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_inbox_page_id_fkey" FOREIGN KEY ("inbox_page_id") REFERENCES "pages"("id") ON DELETE SET NULL;