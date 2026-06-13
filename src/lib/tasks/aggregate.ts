/**
 * v0.9.0 G4 P23 — Tasks hub aggregator.
 *
 * `listMyTasks` reads from the `mv_user_tasks` materialized view (refreshed by
 * a STATEMENT-level trigger on `pages` content changes) and post-filters by
 * v0.7 ACL chain: the user must either be a member of the workspace or carry
 * an explicit `page_acls` row for the page. Encrypted pages are already
 * excluded at the view layer (P5/P6/P7 — pages.encrypted=true rows never enter
 * the view because their `content` is empty by contract).
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb } from '@/db/client';
import type * as schema from '@/db/schema';

export type MyTaskRow = {
  pageId: string;
  workspaceId: string;
  blockId: string;
  text: string;
  checked: boolean;
  dueAt: Date | null;
  pageTitle: string;
  pageIcon: string | null;
};

export type ListMyTasksOpts = {
  workspaceId?: string;
  status?: 'open' | 'done' | 'all';
  dueBy?: Date;
};

type Row = {
  page_id: string;
  workspace_id: string;
  block_id: string;
  text: string;
  checked: boolean;
  due_at_iso: string | null;
  page_title: string;
  page_icon: string | null;
};

export async function listMyTasks(userId: string, opts: ListMyTasksOpts): Promise<MyTaskRow[]> {
  const db = getDb();
  const status = opts.status ?? 'open';

  // Permission gate: page must either belong to a workspace the user is a
  // member of, or carry an explicit page_acls row (v0.7 ACL chain). The
  // OUTER JOIN + IS NOT NULL pattern keeps it a single round-trip.
  const rows = (await db.execute(sql`
    SELECT
      mv.page_id, mv.workspace_id, mv.block_id, mv.text, mv.checked, mv.due_at_iso,
      p.title AS page_title, p.icon AS page_icon
    FROM mv_user_tasks mv
    JOIN pages p ON p.id = mv.page_id AND p.deleted_at IS NULL AND p.encrypted = false
    LEFT JOIN workspace_members wm
      ON wm.workspace_id = mv.workspace_id AND wm.user_id = ${userId}
    LEFT JOIN page_acls pa
      ON pa.page_id = mv.page_id AND pa.user_id = ${userId}
    WHERE mv.user_id = ${userId}
      AND (wm.user_id IS NOT NULL OR pa.user_id IS NOT NULL)
      ${opts.workspaceId ? sql`AND mv.workspace_id = ${opts.workspaceId}` : sql``}
      ${
        status === 'open'
          ? sql`AND mv.checked = false`
          : status === 'done'
            ? sql`AND mv.checked = true`
            : sql``
      }
      ${
        opts.dueBy
          ? sql`AND mv.due_at_iso IS NOT NULL AND mv.due_at_iso::timestamptz <= ${opts.dueBy.toISOString()}::timestamptz`
          : sql``
      }
    ORDER BY mv.due_at_iso NULLS LAST, mv.created_at DESC
  `)) as unknown as Row[];

  return rows.map((r) => ({
    pageId: r.page_id,
    workspaceId: r.workspace_id,
    blockId: r.block_id,
    text: r.text,
    checked: r.checked,
    dueAt: r.due_at_iso ? new Date(r.due_at_iso) : null,
    pageTitle: r.page_title,
    pageIcon: r.page_icon,
  }));
}

/**
 * v0.10.2 S9 — open-task count for the sidebar "My tasks" badge.
 *
 * Same FROM/permission chain as `listMyTasks` with `status: 'open'` and no
 * workspace filter, collapsed to a single COUNT — so the badge always equals
 * the row count the /my-tasks page renders in its default (open, all
 * workspaces) view. db-injected (unlike `listMyTasks`) so unit tests can pass
 * a Testcontainers handle directly.
 */
export async function countMyOpenTasks(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS value
    FROM mv_user_tasks mv
    JOIN pages p ON p.id = mv.page_id AND p.deleted_at IS NULL AND p.encrypted = false
    LEFT JOIN workspace_members wm
      ON wm.workspace_id = mv.workspace_id AND wm.user_id = ${userId}
    LEFT JOIN page_acls pa
      ON pa.page_id = mv.page_id AND pa.user_id = ${userId}
    WHERE mv.user_id = ${userId}
      AND (wm.user_id IS NOT NULL OR pa.user_id IS NOT NULL)
      AND mv.checked = false
  `)) as unknown as Array<{ value: number }>;
  return rows[0]?.value ?? 0;
}
