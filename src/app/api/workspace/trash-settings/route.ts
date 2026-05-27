import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';

/**
 * v0.9.0 G2 P13 — Trash retention settings API.
 *
 * - GET: current `trash_retention_days` for the active workspace (admin-only).
 * - PATCH: update the value. 0 = never auto-purge (manual flow only).
 *
 * The auto-purge cron itself runs out-of-band via the v0.7 scheduler; the
 * `trash:purge --workspace-id=<id>` schedule row already exists for every
 * workspace (registered at creation time), so we only need to mutate the
 * `trash_retention_days` column here.
 */
export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const rows = await getDb()
      .select({ retention: schema.workspaces.trashRetentionDays })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.workspaceId))
      .limit(1);
    return NextResponse.json({ retentionDays: rows[0]?.retention ?? null }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Cap at 3650d (~10y) — anything larger almost certainly indicates a typo, and
// the column is a 4-byte integer so we don't risk overflow regardless.
const PatchSchema = z.object({
  retentionDays: z.coerce.number().int().min(0).max(3650),
});

export async function PATCH(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { retentionDays } = parsed.data;
    await getDb().transaction(async (tx) => {
      await tx
        .update(schema.workspaces)
        .set({ trashRetentionDays: retentionDays })
        .where(eq(schema.workspaces.id, ctx.workspaceId));
      await recordAudit(tx, {
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.userId,
        action: 'workspace.settings_changed',
        targetType: 'workspace',
        targetId: ctx.workspaceId,
        metadata: { setting: 'trash_retention_days', value: retentionDays },
      });
    });
    return NextResponse.json({ retentionDays }, { status: 200 });
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
