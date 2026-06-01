import { NextResponse } from 'next/server';
import { z } from 'zod';
import type * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { TRIGGER_EVENTS } from '@/lib/automation/dispatcher';
import { dryRunRule } from '@/lib/automation/dry-run';
import { samplePayloadFor } from '@/lib/automation/sample-payloads';

const ACTION_TYPES = ['notify', 'send_webhook', 'set_property', 'create_page'] as const;

const TestInput = z.object({
  triggerEvent: z.enum(TRIGGER_EVENTS),
  condition: z.record(z.string(), z.unknown()).default({}),
  actionType: z.enum(ACTION_TYPES),
  actionConfig: z.record(z.string(), z.unknown()),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    await requireRole('admin');
    const body = TestInput.parse(await req.json());
    const payload = body.payload ?? samplePayloadFor(body.triggerEvent);
    const result = dryRunRule(
      {
        condition: body.condition as schema.AutomationCondition,
        actionType: body.actionType,
        actionConfig: body.actionConfig,
      },
      payload,
    );
    return NextResponse.json({ result, payload });
  } catch (err) {
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
}
