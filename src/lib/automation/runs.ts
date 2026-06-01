import { and, desc, eq } from 'drizzle-orm';
import type { getDb } from '@/db/client';
import * as schema from '@/db/schema';

export type RunHistoryRow = {
  id: string;
  status: string;
  error: string | null;
  triggerPayload: Record<string, unknown>;
  createdAt: string;
};

/**
 * Load the most recent runs for a rule, but only if the rule belongs to
 * `workspaceId` (cross-workspace returns null → caller emits 404). Checks the
 * rule's workspace first, then reads automation_runs scoped to that rule.
 */
export async function listRunsForRule(
  db: ReturnType<typeof getDb>,
  args: { ruleId: string; workspaceId: string; limit?: number },
): Promise<RunHistoryRow[] | null> {
  const [rule] = await db
    .select({ id: schema.automationRules.id })
    .from(schema.automationRules)
    .where(
      and(
        eq(schema.automationRules.id, args.ruleId),
        eq(schema.automationRules.workspaceId, args.workspaceId),
      ),
    )
    .limit(1);
  if (!rule) return null;

  const rows = await db
    .select({
      id: schema.automationRuns.id,
      status: schema.automationRuns.status,
      error: schema.automationRuns.error,
      triggerPayload: schema.automationRuns.triggerPayload,
      createdAt: schema.automationRuns.createdAt,
    })
    .from(schema.automationRuns)
    .where(eq(schema.automationRuns.ruleId, args.ruleId))
    .orderBy(desc(schema.automationRuns.createdAt))
    .limit(args.limit ?? 25);

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    error: r.error,
    triggerPayload: r.triggerPayload,
    createdAt: r.createdAt.toISOString(),
  }));
}
