import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { purgeWorkspaceTrash } from '@/lib/trash/purge';

/**
 * v0.9.0 G2 P13 — "Empty trash now" admin button.
 *
 * Runs `purgeWorkspaceTrash` with `retentionDays: 0` so EVERY trashed page is
 * removed regardless of age, and `reason: 'manual'` so the audit row is tagged
 * `trash.purged_manual` (distinct from the cron's `trash.purged_auto`).
 */
export async function POST(): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const result = await purgeWorkspaceTrash(getDb(), {
      workspaceId: ctx.workspaceId,
      retentionDays: 0,
      reason: 'manual',
    });
    return NextResponse.json(
      {
        purgedCount: result.purgedCount,
        descendantsCount: result.descendantsCount,
        bytesReclaimed: result.bytesReclaimed,
      },
      { status: 200 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

function toErrorResponse(err: unknown): Response {
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
