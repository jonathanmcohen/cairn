-- 0065 v0.9.9 G3 (#41/#220): support the semantic-snippet join.
-- searchSemantic() now also reads pages.content_text for the kNN hit set.
-- This partial index keeps the page lookup on the search-visible rows cheap
-- (the same predicate searchFts/searchSemantic apply) without indexing
-- soft-deleted, encrypted, or non-published pages.
CREATE INDEX IF NOT EXISTS pages_search_visible_idx
  ON pages (workspace_id, id)
  WHERE deleted_at IS NULL
    AND encrypted = false
    AND status NOT IN ('draft', 'archived');
