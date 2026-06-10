-- 0070_backfill_default_page_status_draft.sql
-- v0.9.19 A3 (#37) — migration 0066 flipped the workspaces.default_page_status
-- COLUMN DEFAULT to 'draft' but left existing rows untouched, so workspaces
-- created under 0042's DEFAULT 'published' still mint published pages — the
-- live miss the user reported. Backfill those rows to the current product
-- default. Idempotent + data only (no schema change); hand-written because
-- db:generate does not emit backfills.
--
-- Accepted limitation: an admin who EXPLICITLY chose 'published' after v0.9.9
-- is indistinguishable from a pre-0066 row and is reset to 'draft' too. The
-- setting is one click to restore in Settings → Workspace → General; the
-- v0.9.19 release notes call this out.
UPDATE "workspaces"
SET "default_page_status" = 'draft'
WHERE "default_page_status" = 'published';
