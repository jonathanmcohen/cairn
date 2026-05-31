import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { TRIGGER_EVENTS } from '@/lib/automation/dispatcher';

const ACTION_TYPES = ['notify', 'send_webhook', 'set_property', 'create_page'] as const;

const RuleUpdate = z
  .object({
    name: z.string().min(1).max(200).optional(),
    triggerEvent: z.enum(TRIGGER_EVENTS).optional(),
    condition: z.record(z.string(), z.unknown()).optional(),
    actionType: z.enum(ACTION_TYPES).optional(),
    actionConfig: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
    builder: z.record(z.string(), z.unknown()).nullish(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'no fields to update' });

type Ctx = { params: Promise<{ ruleId: string }> };

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { ruleId } = await params;
    const patch = RuleUpdate.parse(await req.json());
    // Cross-workspace = 404 (per cairn convention — never 403, never leak existence).
    const updateValues: Partial<schema.NewAutomationRule> = {};
    if (patch.name !== undefined) updateValues.name = patch.name;
    if (patch.triggerEvent !== undefined) updateValues.triggerEvent = patch.triggerEvent;
    if (patch.condition !== undefined)
      updateValues.condition = patch.condition as schema.AutomationCondition;
    if (patch.actionType !== undefined) updateValues.actionType = patch.actionType;
    if (patch.actionConfig !== undefined) updateValues.actionConfig = patch.actionConfig;
    if (patch.enabled !== undefined) updateValues.enabled = patch.enabled;
    if (patch.builder !== undefined)
      updateValues.builder = patch.builder as schema.AutomationRule['builder'];

    const [updated] = await getDb()
      .update(schema.automationRules)
      .set(updateValues)
      .where(
        and(
          eq(schema.automationRules.id, ruleId),
          eq(schema.automationRules.workspaceId, ctx.workspaceId),
        ),
      )
      .returning();
    if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { ruleId } = await params;
    const [deleted] = await getDb()
      .delete(schema.automationRules)
      .where(
        and(
          eq(schema.automationRules.id, ruleId),
          eq(schema.automationRules.workspaceId, ctx.workspaceId),
        ),
      )
      .returning({ id: schema.automationRules.id });
    if (!deleted) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
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
