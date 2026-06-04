-- 0068_backfill_legacy_orange_covers.sql
-- v0.9.9 Plan M / #214 — the original v0.8.0 cover picker offered harsh
-- orange/amber hex swatches (#ea580c, #d97706). The curated palette dropped
-- them in v0.9.6 but existing pages.cover rows still persist them. Reassign
-- any such row to the curated default preset (slate-dusk). Idempotent + data
-- only — no schema change. Hand-written: db:generate does not emit backfills.
UPDATE "pages"
SET "cover" = '{"kind":"preset","value":"slate-dusk"}'::jsonb,
    "updated_at" = now()
WHERE "cover" ->> 'kind' = 'color'
  AND lower("cover" ->> 'value') IN ('#ea580c', '#d97706');
