import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { auth } from '@/lib/auth/config';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/dev/oauth-connections/[id] — v0.9.16 Plan F.
 *
 * Per-user wrapper over OAuth token revocation for the Settings → Developer
 * connections list. Scoped to the requesting user (a row owned by someone else
 * returns 404 — no existence leak). Soft-revoke + `oauth.token_revoked` audit in
 * one transaction.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const userId = session.user.id;
  const result = await getDb().transaction(async (tx) => {
    const updated = await tx
      .update(schema.oauthTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.oauthTokens.id, id),
          eq(schema.oauthTokens.userId, userId),
          isNull(schema.oauthTokens.revokedAt),
        ),
      )
      .returning({
        id: schema.oauthTokens.id,
        clientId: schema.oauthTokens.clientId,
        workspaceId: schema.oauthTokens.workspaceId,
      });
    const row = updated[0];
    if (!row) return null;
    await recordAudit(tx, {
      workspaceId: row.workspaceId,
      actorUserId: userId,
      action: 'oauth.token_revoked',
      targetType: 'oauth_token',
      targetId: row.id,
      metadata: { clientId: row.clientId },
    });
    return row;
  });

  if (!result) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
