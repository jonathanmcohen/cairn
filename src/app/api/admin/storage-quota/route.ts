/**
 * v0.10.0 D6 — PATCH /api/admin/storage-quota (admin/owner-only).
 *
 * Sets or clears the workspace storage limit. Body: `{ limitBytes }` where
 * limitBytes is a non-negative integer number of bytes, or null to clear the
 * cap (null = unlimited — the column default). Takes effect on the next
 * upload's checkStorageQuota call; no restart needed. Returns the updated
 * `{ usedBytes, limitBytes }` pair so the admin UI can refresh in place.
 */

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { ensureQuotaRow } from '@/lib/quotas/quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  limitBytes: z.number().int().nonnegative().nullable(),
});

export async function PATCH(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const json = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'limitBytes must be a non-negative integer number of bytes, or null' },
        { status: 400 },
      );
    }
    const db = getDb();
    await ensureQuotaRow(db, ctx.workspaceId);
    await db
      .update(schema.workspaceQuotas)
      .set({ storageBytesLimit: parsed.data.limitBytes, updatedAt: new Date() })
      .where(eq(schema.workspaceQuotas.workspaceId, ctx.workspaceId));
    const row = await ensureQuotaRow(db, ctx.workspaceId);
    return NextResponse.json({
      usedBytes: row.storageBytesUsed,
      limitBytes: row.storageBytesLimit,
    });
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
