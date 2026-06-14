-- 0076_page_position.sql
-- v0.10.2 S8 — explicit sibling ordering for the pages tree (sidebar DnD
-- reorder/reparent).
--
--   - `position`: integer sort key scoped to (workspace_id, parent_id). The
--     tree listers order siblings by (position ASC, created_at ASC) — the
--     created_at tiebreak keeps legacy/0-position rows (inserted by paths that
--     don't compute a position) in their historical order.
--   - Backfill uses GAP NUMBERING (row_number * 1024) so future inserts and
--     moves can bisect between neighbors without renumbering the whole sibling
--     group; movePage renumbers a group back to *1024 only when a gap closes
--     below 1 (src/lib/pages/move.ts).
--   - Window PARTITION BY groups NULL parent_id rows together, so root pages
--     of a workspace form one ordered group — same grouping the tree DFS uses.
--
-- Hand-written (db:generate does not emit backfills). IDEMPOTENT: the column
-- and index ride on IF NOT EXISTS; the backfill only touches rows still at the
-- default 0, so a re-run cannot clobber user-made orderings.
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "pages" SET "position" = ranked.pos
FROM (
  SELECT id, (row_number() OVER (PARTITION BY workspace_id, parent_id ORDER BY created_at ASC, id ASC)) * 1024 AS pos
  FROM "pages"
) AS ranked
WHERE "pages".id = ranked.id AND "pages"."position" = 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pages_workspace_parent_position_idx" ON "pages" ("workspace_id", "parent_id", "position");
