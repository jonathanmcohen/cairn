/**
 * v0.9.0 G8 P42 — admin upgrade status endpoint.
 *
 * Returns the bundled `package.json#version` and (if present) the highest
 * version that has appeared in an `upgrade_available` notification row.
 * Admin-only — gated by `requireRole('admin')` so it matches the
 * /settings/admin/upgrade page that surfaces it.
 *
 * The "available" version is sourced from notifications (NOT a remote
 * fetch) so the page is fast and works even when the upstream feed is
 * unreachable — the release-watch cron has already done the polling work
 * and persisted the highest tag it observed.
 */
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import semver from 'semver';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { readPackageVersion } from '@/lib/upgrade/version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request): Promise<Response> {
  try {
    await requireRole('admin');
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  const db = getDb();
  // The release-watch fan-out inserts one row per (admin, workspace,
  // version), so the latest known available version is the semver-max
  // across DISTINCT (payload->>'version') values. We pull DISTINCT versions
  // (a tiny set: at most a handful of versions ever observed) and pick max
  // in JS via `semver.rcompare` — Postgres text ordering would put "0.9.0"
  // above "0.10.0" because of lexicographic dot-split semantics.
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (payload->>'version') payload
    FROM notifications
    WHERE type = 'upgrade_available'
    ORDER BY payload->>'version', created_at DESC
  `)) as unknown as Array<{ payload: { version: string; releaseNotesUrl: string } }>;

  const ordered = rows
    .filter((r) => semver.valid(r.payload.version))
    .sort((a, b) => semver.rcompare(a.payload.version, b.payload.version));
  const top = ordered[0]?.payload;

  const currentVersion = await readPackageVersion();
  return NextResponse.json({
    currentVersion,
    availableVersion: top?.version ?? null,
    releaseNotesUrl: top?.releaseNotesUrl ?? null,
  });
}
