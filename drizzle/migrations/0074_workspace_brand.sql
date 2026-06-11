-- 0074_workspace_brand.sql
-- v0.10.0 F1 — workspace brand: logo + primary-color override.
--
-- Two nullable columns on workspaces; NULL = today's behavior (no logo, the
-- theme's default accent):
--   - brand_logo_file_id  → files(id), ON DELETE SET NULL so deleting the
--     uploaded logo file simply clears the brand logo (no dangling pointer,
--     no cascade into the workspace row).
--   - brand_primary_color → normalized '#rrggbb' hex written by
--     setWorkspaceBrand (src/lib/workspaces/brand.ts). No DB-level CHECK —
--     the API validates; readers re-clamp for contrast at render time as
--     defense-in-depth.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS on both; the FK rides on the column
-- definition so it is only created when the column is.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "brand_logo_file_id" uuid REFERENCES "files"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "brand_primary_color" text;
