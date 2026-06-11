/**
 * Post-v0.10.0 — POST /api/admin/oauth-clients/[id]/rotate (admin/owner-only).
 *
 * Mints a fresh client secret for a CONFIDENTIAL client and answers 200
 * `{ clientSecret }` — the ONE-TIME plaintext, never persisted or logged; the
 * response body is its only carrier. The old secret stops verifying at the
 * token endpoint immediately (only the sha256 hash is stored, and it is
 * replaced in place). Rotating a PUBLIC (PKCE-only) client is a 400 — there
 * is no secret to rotate.
 *
 * `[id]` is the oauth_clients uuid primary key, matching the sibling DELETE
 * route's addressing (Next.js forbids a differently-named dynamic segment at
 * the same path level, so a `[clientId]` sibling is not possible).
 */

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { rotateClientSecret } from '@/lib/oauth/admin-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const auth = await requireRole('admin');
    const { id } = await ctx.params;
    // A non-uuid id can never match a row; answering 404 here avoids a
    // Postgres uuid-cast error surfacing as a 500 (same as the DELETE route).
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const db = getDb();
    const [client] = await db
      .select({ clientId: schema.oauthClients.clientId })
      .from(schema.oauthClients)
      .where(eq(schema.oauthClients.id, id))
      .limit(1);
    if (!client) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const result = await rotateClientSecret(db, client.clientId);
    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    if (result.kind === 'public_client') {
      return NextResponse.json(
        { error: 'public (PKCE-only) clients have no secret to rotate' },
        { status: 400 },
      );
    }

    await recordAudit(db, {
      workspaceId: auth.workspaceId,
      actorUserId: auth.userId,
      action: 'oauth.client_secret_rotated',
      targetType: 'oauth_client',
      targetId: result.row.id,
      // ids only — NEVER the minted secret.
      metadata: { clientId: result.row.clientId, name: result.row.clientName },
    });

    // The response body is the ONLY carrier of the plaintext secret.
    return NextResponse.json({ clientSecret: result.clientSecret });
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
