import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ tokenId: string }> },
): Promise<Response> {
  const session = await requireRole('admin').catch(() => null);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { tokenId } = await ctx.params;
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.scimTokens)
    .where(
      and(
        eq(schema.scimTokens.id, tokenId),
        eq(schema.scimTokens.workspaceId, session.workspaceId),
      ),
    )
    .limit(1);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await db.transaction(async (tx) => {
      await tx.delete(schema.scimTokens).where(eq(schema.scimTokens.id, tokenId));
      await recordAudit(tx, {
        workspaceId: session.workspaceId,
        actorUserId: session.userId,
        action: 'sso.scim.token.revoked',
        targetType: 'scim_token',
        targetId: tokenId,
        metadata: { name: existing.name },
      });
    });
  } catch (err) {
    console.error('[admin/sso/scim-tokens] revoke transaction failed', err);
    return NextResponse.json({ error: 'Failed to revoke token' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
