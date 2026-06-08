import { and, eq, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { dayWindowStart, monthWindowStart } from '@/lib/auth/pat-quota-windows';
import { HttpError, requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

/**
 * Admin-only: clear the CURRENT day-window + current month-window rollup rows
 * for `tokenId`. The token can immediately spend its full daily + monthly cap
 * again; the 14-day rolling sparkline history (prior days' rows) is preserved
 * so the dashboard sparkline doesn't go blank after a reset.
 *
 * The configured per-token caps in `personal_access_tokens` are NOT touched.
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

    const now = new Date();
    const dayStart = dayWindowStart(now);
    const monthStart = monthWindowStart(now);
    await db.transaction(async (tx) => {
      // Scope: only the CURRENT day-window 'day' row + CURRENT month-window
      // 'month' row. Match on (windowKind, windowStart) PAIRS, not windowStart
      // alone — early in a month a historical 'day' row's windowStart can equal
      // monthStart (e.g. on the 8th, the T-7 day row lands on the 1st = month
      // start), and a windowStart-only `inArray` would wrongly delete it,
      // wiping the sparkline history. Kind-scoped predicates keep T-13..T-1.
      await tx
        .delete(schema.patQuotaUsage)
        .where(
          and(
            eq(schema.patQuotaUsage.tokenId, tokenId),
            or(
              and(
                eq(schema.patQuotaUsage.windowKind, 'day'),
                eq(schema.patQuotaUsage.windowStart, dayStart),
              ),
              and(
                eq(schema.patQuotaUsage.windowKind, 'month'),
                eq(schema.patQuotaUsage.windowStart, monthStart),
              ),
            ),
          ),
        );
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
