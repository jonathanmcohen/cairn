import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { HttpError, requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

/**
 * Admin-only: delete every `pat_quota_usage` row for `tokenId` (all windows
 * for both `day` and `month` kinds). The configured per-token caps in
 * `personal_access_tokens` are NOT touched.
 *
 * Cross-workspace tokens return 404 (existence-hiding pattern).
 * Delete + `pat.quota_reset` audit happen in a single transaction so the
 * audit can never drift from the action.
 *
 * v0.9.0 G1 P10.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ tokenId: string }> },
): Promise<Response> {
  try {
    const auth = await requireRole('admin');
    const { tokenId } = await ctx.params;
    const db = getDb();

    // Existence + workspace-ownership check FIRST — admin in workspace A must
    // not be able to clear quotas for a token in workspace B.
    const [row] = await db
      .select({ id: schema.personalAccessTokens.id })
      .from(schema.personalAccessTokens)
      .where(
        and(
          eq(schema.personalAccessTokens.id, tokenId),
          eq(schema.personalAccessTokens.workspaceId, auth.workspaceId),
        ),
      );
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    await db.transaction(async (tx) => {
      await tx.delete(schema.patQuotaUsage).where(eq(schema.patQuotaUsage.tokenId, tokenId));
      await recordAudit(tx, {
        workspaceId: auth.workspaceId,
        actorUserId: auth.userId,
        action: 'pat.quota_reset',
        targetType: 'personal_access_token',
        targetId: tokenId,
        metadata: {},
      });
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
