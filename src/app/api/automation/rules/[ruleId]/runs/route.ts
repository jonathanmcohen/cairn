import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { listRunsForRule } from '@/lib/automation/runs';

type Ctx = { params: Promise<{ ruleId: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const { ruleId } = await params;
    const runs = await listRunsForRule(getDb(), { ruleId, workspaceId: ctx.workspaceId });
    if (runs === null) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ runs });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
