CREATE TABLE "chat_posted_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"thread_ts" text,
	"page_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "kind" text DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "platform_metadata" jsonb;--> statement-breakpoint
-- v0.9.0 G7 P36 — restrict kind to the discriminator values the dispatcher knows
-- how to translate. Drizzle does not emit CHECK constraints in 0.45, so we append
-- it by hand (CLAUDE.md "Gotchas: db:generate doesn't emit extensions/triggers").
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_kind_check"
  CHECK ("kind" IN ('generic', 'slack', 'discord'));--> statement-breakpoint
ALTER TABLE "chat_posted_messages" ADD CONSTRAINT "chat_posted_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_posted_messages" ADD CONSTRAINT "chat_posted_messages_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_posted_messages" ADD CONSTRAINT "chat_posted_messages_parent_comment_id_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_posted_messages_thread_unique" ON "chat_posted_messages" USING btree ("platform","channel_id","thread_ts");--> statement-breakpoint
CREATE INDEX "chat_posted_messages_message_idx" ON "chat_posted_messages" USING btree ("platform","channel_id","message_id");--> statement-breakpoint
CREATE INDEX "chat_posted_messages_workspace_idx" ON "chat_posted_messages" USING btree ("workspace_id");