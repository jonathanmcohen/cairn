-- v0.9.0 G2 P12 — Workspace-pinned pages
-- Admins curate a workspace-wide "Pinned" section that renders at the top
-- of the sidebar for every member, above the per-user Favorites (v0.8 P17)
-- and the per-space groups (v0.9 P11). Drag-reorderable: `position` is the
-- 0..N sort key; `pinned_by` records the actor for audit-trail correlation.

CREATE TABLE "workspace_pins" (
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "page_id" uuid NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
  "position" integer NOT NULL DEFAULT 0,
  "pinned_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "pinned_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_pins_pk" PRIMARY KEY ("workspace_id", "page_id")
);
--> statement-breakpoint
CREATE INDEX "workspace_pins_workspace_position_idx"
  ON "workspace_pins" ("workspace_id", "position");
