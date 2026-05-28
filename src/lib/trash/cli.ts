/**
 * v0.9.0 G2 P13 — `cli trash:purge --workspace-id=<id>` entry point.
 *
 * The scheduler spawns the compiled CLI for every due `cron_schedules` row;
 * this thin shim opens a postgres-js connection, looks up the per-workspace
 * `trash_retention_days` setting (falling back to `CAIRN_TRASH_RETENTION_DAYS`
 * when the workspace row is missing), and delegates to `purgeWorkspaceTrash`
 * with `reason: 'auto'`.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';
import { type PurgeResult, purgeWorkspaceTrash } from './purge';

export async function runTrashPurgeCli(input: { workspaceId: string }): Promise<PurgeResult> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for trash:purge');
  const sql = postgres(url);
  try {
    const db = drizzle(sql, { schema });
    const rows = await db
      .select({ retention: schema.workspaces.trashRetentionDays })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, input.workspaceId))
      .limit(1);
    // Workspace row gone → silent no-op (the cron row is FK-cascade-deleted by
    // the workspace delete, but a race-window between the two is possible).
    if (!rows[0]) {
      return { purgedCount: 0, purgedPageIds: [], descendantsCount: 0, bytesReclaimed: 0 };
    }
    // trashRetentionDays NOT NULL with default 30 — but we still honor the
    // global env override for ops who want to lower the default without
    // touching every workspace row.
    const retentionDays = rows[0].retention ?? env().CAIRN_TRASH_RETENTION_DAYS;
    // 0 means "never auto-purge" — admin can still run manual empty-trash.
    if (retentionDays <= 0) {
      return { purgedCount: 0, purgedPageIds: [], descendantsCount: 0, bytesReclaimed: 0 };
    }
    return await purgeWorkspaceTrash(db, {
      workspaceId: input.workspaceId,
      retentionDays,
      reason: 'auto',
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
