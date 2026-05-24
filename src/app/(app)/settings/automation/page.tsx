import { sql as rawSql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { RuleList, type RuleListRow } from '@/components/automation/rule-list';
import { getDb } from '@/db/client';
import type * as schema from '@/db/schema';
import { getAuthContext, hasMinRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

type RawRow = {
  id: string;
  workspace_id: string;
  name: string;
  trigger_event: string;
  condition: schema.AutomationCondition;
  action_type: string;
  action_config: Record<string, unknown>;
  enabled: boolean;
  created_by: string | null;
  created_at: Date;
  last_status: schema.AutomationRunStatus | null;
  last_run_at: Date | null;
};

async function loadRules(workspaceId: string): Promise<RuleListRow[]> {
  const db = getDb();
  // One LATERAL join pulls the newest run per rule. Drizzle 0.45 lacks a
  // first-class LATERAL builder, so this is a single raw SQL query.
  const rows = (await db.execute(rawSql`
    SELECT r.*, lr.status AS last_status, lr.created_at AS last_run_at
    FROM automation_rules r
    LEFT JOIN LATERAL (
      SELECT status, created_at
      FROM automation_runs
      WHERE rule_id = r.id
      ORDER BY created_at DESC
      LIMIT 1
    ) lr ON TRUE
    WHERE r.workspace_id = ${workspaceId}::uuid
    ORDER BY r.created_at DESC
  `)) as unknown as RawRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    triggerEvent: r.trigger_event,
    condition: r.condition,
    actionType: r.action_type as schema.AutomationActionType,
    actionConfig: r.action_config,
    enabled: r.enabled,
    createdAt: r.created_at.toISOString(),
    lastStatus: r.last_status,
    lastRunAt: r.last_run_at ? r.last_run_at.toISOString() : null,
  }));
}

export default async function AutomationSettingsPage() {
  const ctx = await getAuthContext();
  if (!ctx?.workspaceId || !ctx.role) redirect('/login');
  const canMutate = hasMinRole(ctx.role, 'admin');
  const rules = await loadRules(ctx.workspaceId);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-2 text-3xl font-semibold">Automation</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Run actions when events fire in this workspace. Rules evaluate trigger payloads against
        their condition; matching rules run their action and record the outcome.
      </p>
      <RuleList initialRules={rules} canMutate={canMutate} />
    </div>
  );
}
