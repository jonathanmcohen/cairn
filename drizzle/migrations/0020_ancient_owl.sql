CREATE TABLE "user_page_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"favorite_order" integer,
	"last_visited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_page_prefs" ADD CONSTRAINT "user_page_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_page_prefs" ADD CONSTRAINT "user_page_prefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_page_prefs" ADD CONSTRAINT "user_page_prefs_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_page_prefs_user_page_unique" ON "user_page_prefs" USING btree ("user_id","page_id");--> statement-breakpoint
CREATE INDEX "user_page_prefs_favorites_idx" ON "user_page_prefs" USING btree ("user_id","workspace_id","favorite","favorite_order");--> statement-breakpoint
CREATE INDEX "user_page_prefs_recents_idx" ON "user_page_prefs" USING btree ("user_id","workspace_id","last_visited_at");