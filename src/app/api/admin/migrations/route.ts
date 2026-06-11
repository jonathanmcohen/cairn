/**
 * v0.10.0 D7 — GET /api/admin/migrations (admin/owner-only).
 *
 * Read-only migration status: the bundled journal vs the live
 * `drizzle.__drizzle_migrations` table. Same JSON the
 * /settings/admin/migrations panel renders.
 *
 * No mutation surface here on purpose — the v0.9.17 postmortem rejected
 * in-process migration retry (duplicate-ALTER trap). Recovery is documented
 * guidance: restart for pending (migrations apply at boot), image-roll or
 * backup-restore for drift.
 *
 * If the journal cannot be located on this deployment (resolveJournalPath
 * probes cwd AND ../../ for the standalone-server case), answer 503 degraded
 * rather than crashing — status reporting must not take the route down.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { getMigrationStatus, loadJournalFromPath, resolveJournalPath } from '@/lib/upgrade/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    const journalPath = resolveJournalPath();
    if (!journalPath) {
      return NextResponse.json(
        { error: 'migration journal not found on this deployment' },
        { status: 503 },
      );
    }
    const journal = await loadJournalFromPath(journalPath);
    const status = await getMigrationStatus(getDb(), journal);
    return NextResponse.json(status);
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
