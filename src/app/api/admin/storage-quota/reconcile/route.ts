/**
 * v0.10.0 D6 — POST /api/admin/storage-quota/reconcile (admin/owner-only).
 *
 * Recomputes storage_bytes_used from the canonical sum(files.size) for the
 * active workspace and writes it back (src/lib/quotas/quota.ts#reconcileQuota
 * — the same routine the CLI reconcile subcommand runs). The incremental
 * counter can drift after crashes between blob write and row insert; this is
 * the in-product backstop. Returns the post-reconcile counters.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { ensureQuotaRow, reconcileQuota } from '@/lib/quotas/quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const db = getDb();
    const usedBytes = await reconcileQuota(db, ctx.workspaceId);
    const row = await ensureQuotaRow(db, ctx.workspaceId);
    return NextResponse.json({ usedBytes, limitBytes: row.storageBytesLimit });
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
