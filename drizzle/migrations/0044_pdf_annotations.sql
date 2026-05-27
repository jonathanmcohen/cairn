CREATE TABLE "pdf_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"rect" jsonb NOT NULL,
	"kind" text NOT NULL,
	"content" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdf_annotations" ADD CONSTRAINT "pdf_annotations_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_annotations" ADD CONSTRAINT "pdf_annotations_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_annotations" ADD CONSTRAINT "pdf_annotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_annotations" ADD CONSTRAINT "pdf_annotations_kind_check" CHECK (kind IN ('highlight','comment','shape'));--> statement-breakpoint
CREATE INDEX "pdf_annotations_lookup_idx" ON "pdf_annotations" ("file_id","page_number","created_by");