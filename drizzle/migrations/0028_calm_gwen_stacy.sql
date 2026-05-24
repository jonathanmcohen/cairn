CREATE TABLE "connector_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"row_id" uuid,
	"property_id" uuid,
	"cairn_value" jsonb,
	"external_value" jsonb,
	"cairn_ts" timestamp with time zone NOT NULL,
	"external_ts" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_row_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"cairn_row_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cell_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "database_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"database_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"auth_config" "bytea" NOT NULL,
	"sync_config" jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_conflicts" ADD CONSTRAINT "connector_conflicts_connector_id_database_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."database_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_conflicts" ADD CONSTRAINT "connector_conflicts_row_id_db_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."db_rows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_conflicts" ADD CONSTRAINT "connector_conflicts_property_id_db_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."db_properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_row_map" ADD CONSTRAINT "connector_row_map_connector_id_database_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."database_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_row_map" ADD CONSTRAINT "connector_row_map_cairn_row_id_db_rows_id_fk" FOREIGN KEY ("cairn_row_id") REFERENCES "public"."db_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_connectors" ADD CONSTRAINT "database_connectors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_connectors" ADD CONSTRAINT "database_connectors_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_connectors" ADD CONSTRAINT "database_connectors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_row_map_connector_external_unique" ON "connector_row_map" USING btree ("connector_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_row_map_connector_row_unique" ON "connector_row_map" USING btree ("connector_id","cairn_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "database_connectors_database_id_unique" ON "database_connectors" USING btree ("database_id");