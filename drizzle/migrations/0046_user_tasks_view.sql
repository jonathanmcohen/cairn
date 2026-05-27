-- v0.9.0 G4 P23 — Tasks hub aggregator.
-- Materialized view `mv_user_tasks` exposes every TipTap taskItem node in
-- `pages.content`, fanned out per involved user (assignee + mentionedBy).
-- Refreshed by a STATEMENT-level AFTER trigger on `pages` so bulk edits only
-- pay one REFRESH cost. Encrypted pages (P5/P6/P7 — pages.encrypted = true)
-- are excluded; their `content` jsonb is empty by contract.

CREATE OR REPLACE FUNCTION extract_tasks_from_content(content jsonb)
RETURNS TABLE (
  block_id     text,
  task_text    text,
  checked      boolean,
  assigned_to  uuid,
  mentioned_by uuid,
  due_at_iso   text
)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH RECURSIVE walk(node) AS (
    SELECT content
    UNION ALL
    SELECT child
    FROM walk,
         jsonb_array_elements(COALESCE(walk.node->'content', '[]'::jsonb)) AS child
  ),
  task_nodes AS (
    SELECT node
    FROM walk
    WHERE node->>'type' = 'taskItem'
  )
  SELECT
    (node->'attrs'->>'blockId')::text                                                       AS block_id,
    COALESCE(node->'attrs'->>'text', node #>> '{content,0,content,0,text}', '')::text       AS task_text,
    COALESCE((node->'attrs'->>'checked')::boolean, false)                                   AS checked,
    NULLIF(node->'attrs'->>'assignedTo','')::uuid                                           AS assigned_to,
    NULLIF(node->'attrs'->>'mentionedBy','')::uuid                                          AS mentioned_by,
    NULLIF(node->'attrs'->>'dueAt','')                                                      AS due_at_iso
  FROM task_nodes;
$$;
--> statement-breakpoint

DROP MATERIALIZED VIEW IF EXISTS mv_user_tasks;
--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_user_tasks AS
WITH page_tasks AS (
  SELECT
    p.id           AS page_id,
    p.workspace_id AS workspace_id,
    p.created_at   AS page_created_at,
    t.block_id,
    t.task_text,
    t.checked,
    t.assigned_to,
    t.mentioned_by,
    t.due_at_iso
  FROM pages p
  CROSS JOIN LATERAL extract_tasks_from_content(p.content) AS t
  WHERE p.deleted_at IS NULL
    AND p.encrypted = false
)
SELECT
  u.user_id::uuid                                       AS user_id,
  page_tasks.page_id,
  page_tasks.workspace_id,
  page_tasks.block_id,
  page_tasks.task_text                                  AS text,
  page_tasks.checked,
  page_tasks.assigned_to,
  page_tasks.mentioned_by,
  page_tasks.due_at_iso,
  page_tasks.page_created_at                            AS created_at
FROM page_tasks
CROSS JOIN LATERAL (
  SELECT DISTINCT v.user_id
  FROM (VALUES (page_tasks.assigned_to), (page_tasks.mentioned_by)) AS v(user_id)
  WHERE v.user_id IS NOT NULL
) AS u
WHERE page_tasks.block_id IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX mv_user_tasks_pk
  ON mv_user_tasks (user_id, page_id, block_id);
--> statement-breakpoint

CREATE INDEX mv_user_tasks_user_workspace
  ON mv_user_tasks (user_id, workspace_id);
--> statement-breakpoint

CREATE INDEX mv_user_tasks_user_checked
  ON mv_user_tasks (user_id, checked);
--> statement-breakpoint

CREATE INDEX mv_user_tasks_user_due
  ON mv_user_tasks (user_id, due_at_iso);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION refresh_mv_user_tasks()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- CONCURRENTLY requires the unique index above (mv_user_tasks_pk).
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_tasks;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS pages_refresh_user_tasks ON pages;
--> statement-breakpoint

-- STATEMENT-level: fires once per UPDATE batch, not per row — avoids N refreshes
-- during bulk edits. Listens to content changes plus deletes (soft-delete is an
-- UPDATE of deleted_at, but a hard DELETE needs handling too).
CREATE TRIGGER pages_refresh_user_tasks
AFTER INSERT OR UPDATE OF content, deleted_at, encrypted OR DELETE ON pages
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_mv_user_tasks();
