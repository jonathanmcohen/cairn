-- v0.9.8 G5: nested AND/OR condition tree on automation_rules.
-- Reversible: see the rollback block at the bottom (commented; run by hand to revert).
ALTER TABLE "automation_rules" ADD COLUMN IF NOT EXISTS "condition_tree" jsonb;

-- Backfill: wrap each existing flat condition as one implicit AND group.
-- Idempotent — only touches rows whose tree is still NULL.
UPDATE "automation_rules"
SET "condition_tree" = CASE
  WHEN "condition" ? 'operator'
    THEN jsonb_build_object('logic', 'and', 'children',
           jsonb_build_array(jsonb_build_object(
             'field', "condition"->>'property',
             'op',    "condition"->>'operator',
             'value', "condition"->'value')))
  ELSE jsonb_build_object('logic', 'and', 'children', '[]'::jsonb)
END
WHERE "condition_tree" IS NULL;

-- Keep condition_tree populated for rules created via the legacy singular-condition
-- API path (which only writes automation_rules.condition). A NEW row whose
-- condition_tree is NULL gets the same implicit-AND wrap applied before insert,
-- so the dispatcher always sees a tree (mirrors flatConditionToTree in JS).
CREATE OR REPLACE FUNCTION "automation_backfill_condition_tree"() RETURNS trigger AS $$
BEGIN
  IF NEW."condition_tree" IS NULL THEN
    NEW."condition_tree" := CASE
      WHEN NEW."condition" ? 'operator'
        THEN jsonb_build_object('logic', 'and', 'children',
               jsonb_build_array(jsonb_build_object(
                 'field', NEW."condition"->>'property',
                 'op',    NEW."condition"->>'operator',
                 'value', NEW."condition"->'value')))
      ELSE jsonb_build_object('logic', 'and', 'children', '[]'::jsonb)
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "automation_rules_backfill_condition_tree" ON "automation_rules";
CREATE TRIGGER "automation_rules_backfill_condition_tree"
  BEFORE INSERT ON "automation_rules"
  FOR EACH ROW EXECUTE FUNCTION "automation_backfill_condition_tree"();

-- ROLLBACK (run manually to revert this migration):
--   DROP TRIGGER IF EXISTS "automation_rules_backfill_condition_tree" ON "automation_rules";
--   DROP FUNCTION IF EXISTS "automation_backfill_condition_tree"();
--   ALTER TABLE "automation_rules" DROP COLUMN IF EXISTS "condition_tree";
