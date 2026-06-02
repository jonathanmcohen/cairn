-- v0.9.8 G5: ordered multi-action support.
CREATE TABLE IF NOT EXISTS "automation_rule_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rule_id" uuid NOT NULL REFERENCES "automation_rules"("id") ON DELETE CASCADE,
  "action_type" text NOT NULL,
  "action_config" jsonb NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "automation_rule_actions_rule_order_idx"
  ON "automation_rule_actions" ("rule_id", "sort_order");

-- Backfill: each existing rule's singular action becomes its action at index 0.
INSERT INTO "automation_rule_actions" ("rule_id", "action_type", "action_config", "sort_order")
SELECT r."id", r."action_type", r."action_config", 0
FROM "automation_rules" r
WHERE NOT EXISTS (
  SELECT 1 FROM "automation_rule_actions" a WHERE a."rule_id" = r."id"
);

-- Keep the ordered-actions table populated for rules created via the legacy
-- singular-action API path (which only writes automation_rules). A NEW rule with
-- no ordered actions gets its singular action mirrored at sort_order 0.
CREATE OR REPLACE FUNCTION "automation_backfill_action"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "automation_rule_actions" ("rule_id", "action_type", "action_config", "sort_order")
  VALUES (NEW."id", NEW."action_type", NEW."action_config", 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "automation_rules_backfill_action" ON "automation_rules";
CREATE TRIGGER "automation_rules_backfill_action"
  AFTER INSERT ON "automation_rules"
  FOR EACH ROW EXECUTE FUNCTION "automation_backfill_action"();

-- ROLLBACK (run manually):
--   DROP TRIGGER IF EXISTS "automation_rules_backfill_action" ON "automation_rules";
--   DROP FUNCTION IF EXISTS "automation_backfill_action"();
--   DROP TABLE IF EXISTS "automation_rule_actions";
