/**
 * v0.10.0 C2 — destructive restore endpoint (admin/owner only).
 *
 * POST `{ts, confirmDatabase}` starts `node dist/server/cli.js restore --in
 * <bundle> --force` via startRestoreJob and answers 202 with the job id to
 * poll at /api/admin/backups/jobs/[id]. Gates, in order:
 *   - retype gate: `confirmDatabase` must equal the database name parsed from
 *     DATABASE_URL exactly as the CLI parses it (src/lib/backups/db-name.ts).
 *     Mismatch → 400 with a deliberately non-leaky message (the expected name
 *     is never echoed to the client);
 *   - bundle must exist in CAIRN_BACKUP_DIR → 404 otherwise;
 *   - encrypted bundle without CAIRN_BACKUP_ENCRYPTION_PASSPHRASE → upfront
 *     400 naming the env var (same failure class cli.ts raises mid-run);
 *   - a restore already in flight (maintenance active) → 409.
 *
 * GET answers `{maintenance}` so the backups page can detect an in-flight
 * restore on mount (e.g. after the admin reloads mid-restore).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { databaseNameFromUrl } from '@/lib/backups/db-name';
import { startRestoreJob } from '@/lib/backups/jobs';
import { getMaintenance } from '@/lib/backups/maintenance';
import { env } from '@/lib/env';

const Body = z.object({
  // Bundle slug characters only (an ISO timestamp with [:.] → '-', plus the
  // '-uploaded' suffix). Anything else could path-traverse out of
  // CAIRN_BACKUP_DIR when joined into the bundle filename.
  ts: z.string().regex(/^[A-Za-z0-9-]+$/),
  confirmDatabase: z.string().min(1),
});

export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    return NextResponse.json({ maintenance: getMaintenance() });
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

export async function POST(req: Request): Promise<Response> {
  try {
    await requireRole('admin');
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }

    const expected = databaseNameFromUrl(env().DATABASE_URL);
    if (parsed.data.confirmDatabase !== expected) {
      return NextResponse.json({ error: 'confirmation-mismatch' }, { status: 400 });
    }

    const result = startRestoreJob({ dir: env().CAIRN_BACKUP_DIR, ts: parsed.data.ts });
    if (!result.ok) {
      switch (result.error) {
        case 'bundle-missing':
          return NextResponse.json({ error: 'bundle-missing' }, { status: 404 });
        case 'encrypted-passphrase-missing':
          return NextResponse.json(
            {
              error:
                'bundle is encrypted but CAIRN_BACKUP_ENCRYPTION_PASSPHRASE is unset on the server',
            },
            { status: 400 },
          );
        case 'maintenance-active':
          return NextResponse.json({ error: 'restore-already-running' }, { status: 409 });
      }
    }
    return NextResponse.json({ jobId: result.job.id }, { status: 202 });
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
