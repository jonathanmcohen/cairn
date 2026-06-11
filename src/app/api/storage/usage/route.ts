/**
 * v0.10.0 D6 — GET /api/storage/usage (any workspace member).
 *
 * Read-only storage counters for the active workspace: `usedBytes` is the
 * incrementally-maintained workspace_quotas.storage_bytes_used counter (see
 * src/lib/quotas/quota.ts; reconcileQuota is the drift backstop) and
 * `limitBytes` is the admin-set cap (null = unlimited). Gated at `viewer` on
 * purpose — every member can see how full the workspace is; only the
 * /api/admin/storage-quota routes can change the limit.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { ensureQuotaRow } from '@/lib/quotas/quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const row = await ensureQuotaRow(getDb(), ctx.workspaceId);
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
