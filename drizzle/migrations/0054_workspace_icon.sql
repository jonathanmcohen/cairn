-- 0054_workspace_icon.sql
-- v0.9.4 UX audit #81 — workspaces get an optional icon (prefix-encoded
-- "emoji::<unicode>" / "file::<uuid>", same convention as pages.icon).
ALTER TABLE "workspaces" ADD COLUMN "icon" text;
