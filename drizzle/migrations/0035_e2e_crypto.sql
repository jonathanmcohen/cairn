CREATE TABLE "page_encryption_keys" (
	"page_id" uuid NOT NULL,
	"member_user_id" uuid NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_encryption_keys_page_id_member_user_id_pk" PRIMARY KEY("page_id","member_user_id")
);
--> statement-breakpoint
CREATE TABLE "user_keypairs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"public_key" "bytea" NOT NULL,
	"encrypted_private_key" "bytea" NOT NULL,
	"kdf_salt" "bytea" NOT NULL,
	"kdf_iters" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_encryption_keys" (
	"workspace_id" uuid NOT NULL,
	"member_user_id" uuid NOT NULL,
	"wrapped_wsk" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "workspace_encryption_keys_workspace_id_member_user_id_pk" PRIMARY KEY("workspace_id","member_user_id")
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "encrypted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "page_encryption_keys" ADD CONSTRAINT "page_encryption_keys_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_encryption_keys" ADD CONSTRAINT "page_encryption_keys_member_user_id_users_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_keypairs" ADD CONSTRAINT "user_keypairs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_encryption_keys" ADD CONSTRAINT "workspace_encryption_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_encryption_keys" ADD CONSTRAINT "workspace_encryption_keys_member_user_id_users_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;