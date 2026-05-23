import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { auth } from '@/lib/auth/config';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/** Cursor format: base64url(`<createdAtIso>|<id>`) — mirrors v0.6 P18 audit-viewer. */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}
function decodeCursor(c: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(c, 'base64url').toString('utf8');
    const [iso, id] = raw.split('|');
    if (!iso || !id) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return { createdAt: d, id };
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
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

  // Ownership check: usage is queryable only by the token's owner.
  const db = getDb();
  const [owned] = await db
    .select({ id: schema.personalAccessTokens.id })
    .from(schema.personalAccessTokens)
    .where(
      and(
        eq(schema.personalAccessTokens.id, tokenId),
        eq(schema.personalAccessTokens.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT),
  );
  const cursorParam = url.searchParams.get('cursor');

  const conds: SQL[] = [eq(schema.tokenUsageLog.tokenId, tokenId)];
  if (cursorParam) {
    const cur = decodeCursor(cursorParam);
    if (cur) {
      const keyset = or(
        lt(schema.tokenUsageLog.createdAt, cur.createdAt),
        and(eq(schema.tokenUsageLog.createdAt, cur.createdAt), lt(schema.tokenUsageLog.id, cur.id)),
      );
      if (keyset) conds.push(keyset);
    }
  }

  const rows = await db
    .select()
    .from(schema.tokenUsageLog)
    .where(and(...conds))
    .orderBy(desc(schema.tokenUsageLog.createdAt), desc(schema.tokenUsageLog.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;
  const last = entries[entries.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last) : null;

  return NextResponse.json({
    events: entries.map((r) => ({
      id: r.id,
      route: r.route,
      status: r.status,
      mcpTool: r.mcpTool,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor,
  });
}
