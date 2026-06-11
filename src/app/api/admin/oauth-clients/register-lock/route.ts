/**
 * v0.10.0 G5 — GET/POST /api/admin/oauth-clients/register-lock
 * (admin/owner-only).
 *
 * The mutation surface behind the "Registration lock" card on
 * /settings/admin/oauth-clients. GET reports `{ locked }`. POST with
 * `{ locked: true }` turns the RFC 7591 §3.1.1 lock ON and returns the
 * freshly minted initial access token EXACTLY ONCE (`initialAccessToken` in
 * the response body — only the sha256 hash is persisted); POSTing
 * `{ locked: true }` while already locked is the "Regenerate token" path
 * (fresh token, old one stops working). `{ locked: false }` reopens
 * registration and deletes both system_meta keys. Both transitions write an
 * `oauth.register_lock_changed` audit row.
 *
 * Same gate posture as the sibling D3 routes (the lock is instance-level
 * state; the caller must be admin/owner of their active workspace).
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { getRegisterLock, setRegisterLock } from '@/lib/oauth/register-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireRole('admin');
    const lock = await getRegisterLock(getDb());
    return NextResponse.json(lock);
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
    const auth = await requireRole('admin');

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    if (typeof body.locked !== 'boolean') {
      return NextResponse.json({ error: 'locked must be a boolean' }, { status: 400 });
    }

    const result = await setRegisterLock(getDb(), {
      locked: body.locked,
      actorUserId: auth.userId,
      workspaceId: auth.workspaceId,
    });
    // `initialAccessToken` (when present) is the one-time plaintext — it is
    // never persisted and never appears in logs or audit metadata.
    return NextResponse.json(result);
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
