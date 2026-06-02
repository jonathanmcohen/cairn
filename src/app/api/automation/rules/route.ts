import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { TRIGGER_EVENTS } from '@/lib/automation/dispatcher';

const ACTION_TYPES = ['notify', 'send_webhook', 'set_property', 'create_page'] as const;

const RuleInput = z.object({
  name: z.string().min(1).max(200),
  triggerEvent: z.enum(TRIGGER_EVENTS),
  condition: z.record(z.string(), z.unknown()).default({}),
  conditionTree: z.record(z.string(), z.unknown()).nullish(),
  actionType: z.enum(ACTION_TYPES),
  actionConfig: z.record(z.string(), z.unknown()),
  actions: z
    .array(
      z.object({
        type: z.enum(ACTION_TYPES),
        config: z.record(z.string(), z.unknown()),
        sortOrder: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  enabled: z.boolean().optional().default(true),
  builder: z.record(z.string(), z.unknown()).nullish(),
});

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const rows = await getDb()
      .select()
      .from(schema.automationRules)
      .where(eq(schema.automationRules.workspaceId, ctx.workspaceId))
      .orderBy(desc(schema.automationRules.createdAt));
    return NextResponse.json({ rules: rows });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const body = RuleInput.parse(await req.json());
    const [row] = await getDb()
      .insert(schema.automationRules)
      .values({
        workspaceId: ctx.workspaceId,
        name: body.name,
        triggerEvent: body.triggerEvent,
        condition: body.condition as schema.AutomationCondition,
        conditionTree: (body.conditionTree ?? null) as schema.AutomationRule['conditionTree'],
        actionType: body.actionType,
        actionConfig: body.actionConfig,
        builder: (body.builder ?? null) as schema.AutomationRule['builder'],
        enabled: body.enabled,
        createdBy: ctx.userId,
      })
      .returning();
    if (row && body.actions && body.actions.length > 0) {
      // Replace the trigger-backfilled singular action with the explicit ordered set.
      await getDb()
        .delete(schema.automationRuleActions)
        .where(eq(schema.automationRuleActions.ruleId, row.id));
      await getDb()
        .insert(schema.automationRuleActions)
        .values(
          body.actions.map((a) => ({
            ruleId: row.id,
            actionType: a.type,
            actionConfig: a.config,
            sortOrder: a.sortOrder,
          })),
        );
    }
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'unknown' },
    { status: 500 },
  );
}
