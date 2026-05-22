CREATE TYPE "public"."comment_target" AS ENUM('page', 'db_row', 'file');--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "page_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "target_type" "comment_target" DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "target_id" uuid;--> statement-breakpoint
CREATE INDEX "comments_target_idx" ON "comments" USING btree ("target_type","target_id");--> statement-breakpoint
UPDATE "comments" SET "target_id" = "page_id" WHERE "target_id" IS NULL;