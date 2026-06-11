/**
 * v0.10.0 D3 — DELETE /api/admin/oauth-clients/[id] (admin/owner-only).
 *
 * Deregisters a client APPLICATION and revokes EVERY oauth_tokens row issued
 * to it (soft-revoke, matching the RFC 7009 pattern — see
 * `deleteRegisteredClient`). `[id]` is the oauth_clients uuid primary key,
 * not the public client_id. Writes an `oauth.client_deleted` audit row.
 *
 * Distinct from DELETE /api/dev/oauth-connections/[id], which revokes ONE
 * user's grant and leaves the registered app in place.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { deleteRegisteredClient } from '@/lib/oauth/admin-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const auth = await requireRole('admin');
    const { id } = await ctx.params;
    // A non-uuid id can never match a row; answering 404 here avoids a
    // Postgres uuid-cast error surfacing as a 500.
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const result = await deleteRegisteredClient(getDb(), {
      id,
      actorUserId: auth.userId,
      workspaceId: auth.workspaceId,
    });
    if (!result) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, revokedGrants: result.revokedGrants });
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
