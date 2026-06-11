-- 0075_workspace_slash_commands.sql
-- v0.10.0 F2 — custom slash commands → templates.
--
-- A workspace admin binds a trigger word (typed as /<trigger> in the editor)
-- to a saved workspace template; picking the command inserts the template's
-- root-page content at the cursor.
--
--   - trigger: the command word WITHOUT the leading slash, lowercase
--     [a-z0-9-]{2,32} (CHECK below; the API validates first, the constraint is
--     defense-in-depth). UNIQUE per workspace.
--   - template_id → templates(id) ON DELETE CASCADE: deleting the template
--     removes the command row, so a dead template can never leave a slash
--     command that inserts nothing (plan-pinned: "disable" = the command
--     simply disappears from the menu; no broken-flag UI).
--   - enabled: reserved off-switch — disabled rows are excluded from the
--     editor menu but kept in settings.
--
-- IDEMPOTENT: CREATE TABLE/INDEX IF NOT EXISTS; constraints ride on the table
-- definition so they are only created when the table is.
CREATE TABLE IF NOT EXISTS "workspace_slash_commands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "trigger" text NOT NULL CONSTRAINT "workspace_slash_commands_trigger_format" CHECK ("trigger" ~ '^[a-z0-9-]{2,32}$'),
  "template_id" uuid NOT NULL REFERENCES "templates"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_slash_commands_workspace_trigger_unique" UNIQUE ("workspace_id", "trigger")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_slash_commands_template_id_idx" ON "workspace_slash_commands" ("template_id");
