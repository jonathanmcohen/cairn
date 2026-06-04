-- 0066_default_page_status_draft.sql
-- v0.9.9 K2 #216 — new pages should be born as drafts, not published
-- (security-adjacent: prevents accidental publish-before-review). Only the
-- COLUMN DEFAULT changes; existing workspaces keep whatever default an admin
-- already chose, and existing pages.status values are untouched.
ALTER TABLE "workspaces" ALTER COLUMN "default_page_status" SET DEFAULT 'draft';
