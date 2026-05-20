CREATE TABLE IF NOT EXISTS "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"icon" text,
	"content" jsonb DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"content_tsv" "tsvector",
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_root" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pages" ADD CONSTRAINT "pages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pages_workspace_idx" ON "pages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pages_parent_idx" ON "pages" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pages_content_tsv_idx" ON "pages" USING gin ("content_tsv");--> statement-breakpoint
-- Self-referential FK on parent_id (drizzle-kit can't model self-FKs in callback form).
DO $$ BEGIN
 ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_id_pages_id_fk"
   FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
-- Extract plain text from a ProseMirror JSON document, concatenating all `text` nodes.
CREATE OR REPLACE FUNCTION pages_extract_text(doc jsonb) RETURNS text AS $$
DECLARE
  out_text text := '';
  node jsonb;
  txt text;
BEGIN
  FOR node IN
    SELECT value FROM jsonb_path_query(doc, '$.**.text ? (@.type() == "string")') AS value
  LOOP
    txt := node #>> '{}';
    IF txt IS NOT NULL AND txt <> '' THEN
      out_text := out_text || ' ' || txt;
    END IF;
  END LOOP;
  RETURN trim(out_text);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

--> statement-breakpoint
-- Trigger that derives content_text + content_tsv from content + title on every write.
CREATE OR REPLACE FUNCTION pages_sync_search_columns() RETURNS trigger AS $$
BEGIN
  NEW.content_text := pages_extract_text(NEW.content);
  NEW.content_tsv :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.content_text, '')), 'B');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
DROP TRIGGER IF EXISTS pages_search_sync_trigger ON pages;
CREATE TRIGGER pages_search_sync_trigger
  BEFORE INSERT OR UPDATE OF title, content ON pages
  FOR EACH ROW EXECUTE FUNCTION pages_sync_search_columns();