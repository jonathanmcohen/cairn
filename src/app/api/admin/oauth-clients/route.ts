/**
 * v0.10.0 D3 — GET /api/admin/oauth-clients (admin/owner-only).
 *
 * Lists every RFC 7591 dynamically-registered OAuth client APPLICATION on the
 * instance with per-client grant counts. Registration itself is
 * unauthenticated by design (`POST /api/oauth/register`), so without this
 * surface an operator has no way to even see what self-registered. Clients
 * are instance-level rows (no workspace column); the gate is the caller being
 * admin/owner of their active workspace — same posture as the backups/SIEM
 * admin routes. `client_secret_hash` is never returned; `confidential` is the
 * derived boolean.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { listRegisteredClients } from '@/lib/oauth/admin-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    const clients = await listRegisteredClients(getDb());
    return NextResponse.json({ clients });
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
