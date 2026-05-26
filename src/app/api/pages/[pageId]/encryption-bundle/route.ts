import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { pageEncryptionKeys } from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';

/**
 * v0.9.0 G1 P6 — GET /api/pages/[pageId]/encryption-bundle.
 *
 * Returns the caller's bundle for decrypting an E2E-encrypted page:
 *   { contentEncrypted: base64 | null, wrappedDekForMe: base64 | null }
 *
 * If the page is not encrypted, both fields are null (the caller renders the
 * normal jsonb content). If the caller is enrolled (has a wrapped-DEK row),
 * both fields are populated. If the page is encrypted but the caller has no
 * wrapped DEK, we respond 403 — they're a workspace member but not a page
 * member (e.g. joined after encryption + before a re-encrypt).
 *
 * `requirePageAccess('viewer')` enforces workspace+page membership; cross-
 * workspace callers see a 404 (existence-leak guard, same as elsewhere).
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ pageId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { page, ctx } = await requirePageAccess(pageId, 'viewer');

    if (!page.encrypted || !page.contentEncrypted) {
      return NextResponse.json({ contentEncrypted: null, wrappedDekForMe: null });
    }

    const db = getDb();
    const [row] = await db
      .select()
      .from(pageEncryptionKeys)
      .where(
        and(
          eq(pageEncryptionKeys.pageId, pageId),
          eq(pageEncryptionKeys.memberUserId, ctx.userId),
        ),
      );

    if (!row) {
      return NextResponse.json(
        { error: 'no wrapped DEK for caller' },
        { status: 403 },
      );
    }

    return NextResponse.json({
      contentEncrypted: Buffer.from(page.contentEncrypted).toString('base64'),
      wrappedDekForMe: Buffer.from(row.wrappedDek).toString('base64'),
    });
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
