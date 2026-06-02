CREATE TABLE "chat_oauth_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_team_id" text NOT NULL,
	"bot_token_encrypted" "bytea" NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"installed_by" uuid NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "chat_oauth_installs_platform_check" CHECK ("platform" IN ('slack','discord'))
);
--> statement-breakpoint
ALTER TABLE "chat_oauth_installs" ADD CONSTRAINT "chat_oauth_installs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_oauth_installs" ADD CONSTRAINT "chat_oauth_installs_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_oauth_installs_workspace_idx" ON "chat_oauth_installs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_oauth_installs_team_uniq" ON "chat_oauth_installs" USING btree ("workspace_id","platform","external_team_id");
