-- v0.10.3 CFG-2 — instance-global S3-compatible object-storage configuration
-- singleton. One row keyed id='singleton'; DB values override S3_*/FILE_BACKEND
-- env. secret_key is a secret-box envelope (AES-256-GCM), never plaintext. Each
-- consumer (uploads/backups/siem) opts in via its own boolean, default OFF.
CREATE TABLE IF NOT EXISTS "instance_storage_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"provider" text DEFAULT 's3' NOT NULL,
	"endpoint" text NOT NULL,
	"region" text DEFAULT 'us-east-1' NOT NULL,
	"bucket" text NOT NULL,
	"access_key" text,
	"secret_key_encrypted" "bytea",
	"path_prefix" text,
	"public_bucket" boolean DEFAULT false NOT NULL,
	"uploads_enabled" boolean DEFAULT false NOT NULL,
	"backups_enabled" boolean DEFAULT false NOT NULL,
	"siem_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instance_storage_config" ADD CONSTRAINT "instance_storage_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
