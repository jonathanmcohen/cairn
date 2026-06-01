-- v0.9.8 G5: support fast per-rule retention pruning of automation_runs.
CREATE INDEX IF NOT EXISTS "automation_runs_rule_created_idx"
  ON "automation_runs" ("rule_id", "created_at" DESC);

-- ROLLBACK (run manually):
--   DROP INDEX IF EXISTS "automation_runs_rule_created_idx";
