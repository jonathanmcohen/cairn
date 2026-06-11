/**
 * v0.10.0 D4 — GET /api/admin/health (admin/owner-only).
 *
 * Returns the same HealthSnapshot the /settings/admin/health RSC renders, so
 * tooling (and the e2e role-gate spec) has a JSON surface without scraping the
 * page. Deliberately DISTINCT from the open probes:
 *   - /healthz      — unauthenticated machine liveness, 503 on db-down.
 *   - /api/health   — unauthenticated legacy probe, ALWAYS HTTP 200 with the
 *                     state in the body only (do not key an LB on its code).
 * This route is session-gated like every other /api/admin/* route; an editor
 * gets 403 (same posture as backups/SIEM/oauth-clients).
 */

import { NextResponse } from 'next/server';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { getHealthSnapshot } from '@/lib/health/panel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    const snapshot = await getHealthSnapshot();
    return NextResponse.json(snapshot);
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
