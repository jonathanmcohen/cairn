import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { auth } from '@/lib/auth/config';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ tokenId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { tokenId } = await ctx.params;
  if (!UUID_RE.test(tokenId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Soft-revoke: set revoked_at and emit a pat.revoked audit row in the SAME
  // transaction (v0.7.0 G1 P5) so the audit can never drift from the action.
  // Scoped to the requesting user — a token belonging to another user returns
  // 404 (no existence leak). Metadata records only {name}; including the
  // tokenPrefix would trip the `cairn_pat_` substring guard.
  const userId = session.user.id;
  const result = await getDb().transaction(async (tx) => {
    const updated = await tx
      .update(schema.personalAccessTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.personalAccessTokens.id, tokenId),
          eq(schema.personalAccessTokens.userId, userId),
          isNull(schema.personalAccessTokens.revokedAt),
        ),
      )
      .returning({
        id: schema.personalAccessTokens.id,
        name: schema.personalAccessTokens.name,
        workspaceId: schema.personalAccessTokens.workspaceId,
      });
    const row = updated[0];
    if (!row) return null;
    await recordAudit(tx, {
      workspaceId: row.workspaceId,
      actorUserId: userId,
      action: 'pat.revoked',
      targetType: 'personal_access_token',
      targetId: row.id,
      metadata: { name: row.name },
    });
    return row;
  });

  if (!result) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
