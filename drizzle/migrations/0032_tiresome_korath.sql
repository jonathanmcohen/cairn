CREATE TABLE "user_theme_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"accent" text DEFAULT 'default' NOT NULL,
	"font_family" text DEFAULT 'system' NOT NULL,
	"page_width" text DEFAULT 'wide' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_theme_prefs" ADD CONSTRAINT "user_theme_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;