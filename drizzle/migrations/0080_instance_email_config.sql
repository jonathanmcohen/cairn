-- v0.10.3 CFG-1 — instance-global SMTP configuration singleton.
-- One row keyed id='singleton'; DB values override SMTP_* env. Password is a
-- secret-box envelope (AES-256-GCM), never plaintext.
CREATE TABLE IF NOT EXISTS "instance_email_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 587 NOT NULL,
	"tls_mode" text DEFAULT 'starttls' NOT NULL,
	"username" text,
	"password_encrypted" "bytea",
	"from_address" text NOT NULL,
	"reply_to" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instance_email_config" ADD CONSTRAINT "instance_email_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
