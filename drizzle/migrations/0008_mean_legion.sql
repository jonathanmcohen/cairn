CREATE TABLE "page_yjs" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"state" bytea NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_yjs" ADD CONSTRAINT "page_yjs_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;