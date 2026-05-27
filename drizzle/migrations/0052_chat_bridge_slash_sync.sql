CREATE TABLE "chat_bridge_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"team_id" text NOT NULL,
	"bot_token" text NOT NULL,
	"signing_secret" text NOT NULL,
	"installed_by" uuid NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_channel_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"install_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"page_id" uuid NOT NULL,
	"link_mode" text NOT NULL,
	"linked_by" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "chat_message_id" text;--> statement-breakpoint
ALTER TABLE "chat_bridge_installs" ADD CONSTRAINT "chat_bridge_installs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_bridge_installs" ADD CONSTRAINT "chat_bridge_installs_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_links" ADD CONSTRAINT "chat_channel_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_links" ADD CONSTRAINT "chat_channel_links_install_id_chat_bridge_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "public"."chat_bridge_installs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_links" ADD CONSTRAINT "chat_channel_links_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_channel_links" ADD CONSTRAINT "chat_channel_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_bridge_installs_workspace_idx" ON "chat_bridge_installs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_bridge_installs_team_uniq" ON "chat_bridge_installs" USING btree ("workspace_id","platform","team_id");--> statement-breakpoint
CREATE INDEX "chat_channel_links_workspace_idx" ON "chat_channel_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "chat_channel_links_page_idx" ON "chat_channel_links" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_channel_links_channel_uniq" ON "chat_channel_links" USING btree ("install_id","channel_id");--> statement-breakpoint
CREATE INDEX "comments_chat_message_id_idx" ON "comments" USING btree ("chat_message_id");--> statement-breakpoint
-- v0.9.0 G7 P37 — restrict platform + link_mode to the known discriminator
-- values. Drizzle 0.45 doesn't emit CHECK constraints (CLAUDE.md "Gotchas:
-- db:generate doesn't emit extensions/triggers"), so we append them here.
ALTER TABLE "chat_bridge_installs" ADD CONSTRAINT "chat_bridge_installs_platform_check"
  CHECK ("platform" IN ('slack','discord'));--> statement-breakpoint
ALTER TABLE "chat_channel_links" ADD CONSTRAINT "chat_channel_links_link_mode_check"
  CHECK ("link_mode" IN ('notify','sync'));