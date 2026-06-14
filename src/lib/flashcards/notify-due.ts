import { and, countDistinct, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { DEFAULT_REMINDER_HOUR, workspacesFireAtHour } from './notify-due-hour';

type Db = PostgresJsDatabase<typeof schema>;

export type NotifyResult = { notified: number };

/**
 * Daily "flashcards due" notification scan (v0.9.0 G3 P19).
 *
 * For every (user, workspace) pair where the user has at least one due card
 * AND no `flashcards_due` notification yet today (UTC), insert one
 * notification row. Idempotent within a UTC day: re-running the scan in the
 * same day inserts no duplicates.
 *
 * Workspace-scoped: a user in N workspaces with cards due in each gets N
 * separate notifications, one per workspace. That mirrors the bell + drawer
 * model where the bell badge counts per active workspace.
 *
 * Workspace membership gates the scan — we only consider cards the user is
 * actually a member of the owning workspace for. Stale cards in a workspace
 * the user no longer belongs to don't trigger spam.
 *
 * v0.10.2 F3 Task D — per-workspace reminder hour:
 *
 * When `tickHour` is provided (0–23), only workspaces whose `reminderHour`
 * matches are processed in this invocation.  Workspaces with
 * `reminderHour = null` fall back to `DEFAULT_REMINDER_HOUR` (9 UTC).
 *
 * When `tickHour` is NOT provided (legacy / no-arg call), all workspaces
 * with at least one due card are notified regardless of their hour setting —
 * this preserves the pre-F3D behavior for callers that haven't been updated
 * and for unit tests that don't care about hour filtering.
 */
export async function notifyDueFlashcards(
  db: Db,
  now: Date = new Date(),
  tickHour?: number,
): Promise<NotifyResult> {
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  // v0.10.2 F3 Task D — when a tickHour is provided, load per-workspace
  // reminder settings and build an allowSet of workspace IDs that should fire
  // this tick. When tickHour is absent, all workspaces are eligible (backward
  // compat / legacy callers).
  let eligibleWorkspaceIds: Set<string> | null = null;
  if (tickHour !== undefined) {
    const allSettings = await db
      .select({
        workspaceId: schema.workspaceFlashcardSettings.workspaceId,
        reminderHour: schema.workspaceFlashcardSettings.reminderHour,
      })
      .from(schema.workspaceFlashcardSettings);

    // For workspaces without a settings row, they implicitly use the default
    // hour (DEFAULT_REMINDER_HOUR). We resolve them by also fetching ALL
    // workspace IDs and treating any without a settings row as having null.
    const allWorkspaces = await db.select({ id: schema.workspaces.id }).from(schema.workspaces);
    const settingsMap = new Map(allSettings.map((s) => [s.workspaceId, s.reminderHour]));
    const allReminderSettings = allWorkspaces.map((ws) => ({
      workspaceId: ws.id,
      reminderHour: settingsMap.has(ws.id) ? (settingsMap.get(ws.id) ?? null) : null,
    }));

    const firing = workspacesFireAtHour(allReminderSettings, tickHour);
    eligibleWorkspaceIds = new Set(firing.map((s) => s.workspaceId));
  }

  // (workspace, member) pairs with at least one due card for that member.
  // We join workspace_members → flashcard_cards (same workspace) → pages
  // (source page) → reviews (per user) and count cards whose review is missing
  // or past-due.
  //
  // v0.10.2 F1 — mirrors the due-queue eligibility filter: cards on a trashed
  // page (pages.deleted_at), orphaned cards (source_orphaned_at; also dropped
  // by the INNER pages join once page_id is NULL), and suspended cards
  // (suspended_at) never trigger a due notification.
  const dueRows = await db
    .select({
      userId: schema.workspaceMembers.userId,
      workspaceId: schema.flashcardCards.workspaceId,
      count: countDistinct(schema.flashcardCards.id),
    })
    .from(schema.workspaceMembers)
    .innerJoin(
      schema.flashcardCards,
      eq(schema.flashcardCards.workspaceId, schema.workspaceMembers.workspaceId),
    )
    .innerJoin(schema.pages, eq(schema.pages.id, schema.flashcardCards.pageId))
    .leftJoin(
      schema.flashcardReviews,
      and(
        eq(schema.flashcardReviews.cardId, schema.flashcardCards.id),
        eq(schema.flashcardReviews.userId, schema.workspaceMembers.userId),
      ),
    )
    .where(
      and(
        or(isNull(schema.flashcardReviews.dueAt), lte(schema.flashcardReviews.dueAt, now)),
        isNull(schema.flashcardCards.sourceOrphanedAt),
        isNull(schema.flashcardCards.suspendedAt),
        isNull(schema.pages.deletedAt),
      ),
    )
    .groupBy(schema.workspaceMembers.userId, schema.flashcardCards.workspaceId);

  let notified = 0;
  for (const row of dueRows) {
    if (row.count === 0) continue;
    // Skip workspaces that don't fire this tick (only when tickHour was given).
    if (eligibleWorkspaceIds !== null && !eligibleWorkspaceIds.has(row.workspaceId)) continue;
    const [already] = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, row.userId),
          eq(schema.notifications.workspaceId, row.workspaceId),
          eq(schema.notifications.type, 'flashcards_due'),
          gte(schema.notifications.createdAt, todayStart),
        ),
      )
      .limit(1);
    if (already) continue;
    await db.insert(schema.notifications).values({
      userId: row.userId,
      workspaceId: row.workspaceId,
      type: 'flashcards_due',
      payload: { count: Number(row.count) },
    });
    notified++;
  }
  return { notified };
}
