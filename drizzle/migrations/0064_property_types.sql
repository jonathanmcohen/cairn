ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'person';--> statement-breakpoint
ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'file';--> statement-breakpoint
ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'email';--> statement-breakpoint
ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'phone';--> statement-breakpoint
ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'created_time';--> statement-breakpoint
ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'last_edited_time';--> statement-breakpoint
ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'created_by';--> statement-breakpoint
ALTER TYPE "property_type" ADD VALUE IF NOT EXISTS 'last_edited_by';--> statement-breakpoint
ALTER TABLE "db_rows" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "db_rows" ADD CONSTRAINT "db_rows_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE set null;
