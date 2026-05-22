CREATE TYPE "public"."page_link_kind" AS ENUM('link', 'mention', 'embed');--> statement-breakpoint
CREATE TABLE "notification_email_prefs" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"notification_type" text NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"digest_only" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_email_prefs_user_id_workspace_id_notification_type_pk" PRIMARY KEY("user_id","workspace_id","notification_type")
);
--> statement-breakpoint
CREATE TABLE "page_links" (
	"source_page_id" uuid NOT NULL,
	"target_page_id" uuid NOT NULL,
	"kind" "page_link_kind" NOT NULL,
	CONSTRAINT "page_links_source_page_id_target_page_id_kind_pk" PRIMARY KEY("source_page_id","target_page_id","kind")
);
--> statement-breakpoint
ALTER TABLE "notification_email_prefs" ADD CONSTRAINT "notification_email_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_email_prefs" ADD CONSTRAINT "notification_email_prefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_source_page_id_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_target_page_id_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_links_target_idx" ON "page_links" USING btree ("target_page_id");