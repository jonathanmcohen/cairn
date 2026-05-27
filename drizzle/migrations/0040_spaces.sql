-- v0.9.0 G2 P11 — Spaces + per-space ACL chain
-- Adds the `spaces` table (workspace-scoped grouping), the `space_members`
-- role table, and a nullable `pages.space_id` pointer. Self-FK on
-- parent_space_id is appended manually (Drizzle cannot emit self-FKs).

CREATE TABLE "spaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "icon" text,
  "parent_space_id" uuid,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_slug_per_workspace_uq"
  ON "spaces" ("workspace_id", "slug");
--> statement-breakpoint
-- Drizzle can't emit self-FKs in the callback form (CLAUDE.md gotcha):
-- appended manually.
ALTER TABLE "spaces"
  ADD CONSTRAINT "spaces_parent_space_id_fk"
  FOREIGN KEY ("parent_space_id") REFERENCES "spaces"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "spaces_workspace_id_idx" ON "spaces" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "spaces_parent_space_id_idx" ON "spaces" ("parent_space_id");
--> statement-breakpoint
CREATE TABLE "space_members" (
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "space_members_pk" PRIMARY KEY ("space_id", "user_id"),
  CONSTRAINT "space_members_role_chk"
    CHECK ("role" IN ('owner', 'admin', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE INDEX "space_members_user_id_idx" ON "space_members" ("user_id");
--> statement-breakpoint
ALTER TABLE "pages"
  ADD COLUMN "space_id" uuid REFERENCES "spaces"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "pages_space_id_idx" ON "pages" ("space_id");
