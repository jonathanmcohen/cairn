ALTER TYPE "public"."view_type" ADD VALUE IF NOT EXISTS 'list';--> statement-breakpoint
ALTER TABLE "db_rows" ADD COLUMN "parent_row_id" uuid;--> statement-breakpoint
ALTER TABLE "db_rows" ADD CONSTRAINT "db_rows_parent_row_id_db_rows_id_fk" FOREIGN KEY ("parent_row_id") REFERENCES "public"."db_rows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "db_rows_parent_row_id_idx" ON "db_rows" USING btree ("parent_row_id");