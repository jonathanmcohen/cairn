ALTER TABLE "pages" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "locked_by" uuid;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;