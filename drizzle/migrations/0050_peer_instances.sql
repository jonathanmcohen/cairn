CREATE TABLE "peer_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"shared_secret_hash" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "peer_instances" ADD CONSTRAINT "peer_instances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "peer_instances_workspace_name_uq" ON "peer_instances" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "peer_instances_enabled_idx" ON "peer_instances" USING btree ("workspace_id") WHERE enabled = true;