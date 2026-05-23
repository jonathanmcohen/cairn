import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
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
  // Soft-revoke: set revoked_at. Scoped to the requesting user — a token
  // belonging to another user returns 404 (no existence leak).
  const updated = await getDb()
    .update(schema.personalAccessTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.personalAccessTokens.id, tokenId),
        eq(schema.personalAccessTokens.userId, session.user.id),
        isNull(schema.personalAccessTokens.revokedAt),
      ),
    )
    .returning({ id: schema.personalAccessTokens.id });
  if (updated.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
