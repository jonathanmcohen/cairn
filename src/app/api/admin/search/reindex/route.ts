/**
 * v0.10.0 D8 — pgvector index rebuild (admin/owner only).
 *
 * POST starts the two-phase rebuild job (embedding-data pass, then
 * REINDEX INDEX CONCURRENTLY on page_embeddings_embedding_hnsw_idx) and
 * answers 202 `{ job }`. If a rebuild is already running it answers 200 with
 * the EXISTING job instead of starting a second one (debounce contract —
 * two interleaved REINDEXes on the same index would just queue on locks).
 *
 * GET answers `{ job }` with the current/last job (null when never run on
 * this replica) — the admin health card polls it every ~2s while running.
 *
 * DATABASE_URL is read from process.env directly (NOT the cached env()
 * helper) so the dedicated REINDEX connection always uses the live value —
 * same posture as the backup CLI wrappers.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { getRebuildJob, startRebuildJob } from '@/lib/search/rebuild-index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    await requireRole('admin');
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
    }
    const { job, started } = startRebuildJob({ connectionString, db: getDb() });
    return NextResponse.json({ job }, { status: started ? 202 : 200 });
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

export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    return NextResponse.json({ job: getRebuildJob() });
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
