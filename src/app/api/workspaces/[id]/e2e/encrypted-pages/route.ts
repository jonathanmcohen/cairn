import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { pages } from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';

/**
 * v0.9.7 G21 (#168) — GET /api/workspaces/[id]/e2e/encrypted-pages.
 *
 * Owner-only: every WSK-encrypted page in the workspace with its current
 * ciphertext, so the rekey client can decrypt-with-old-WSK + re-encrypt-with-
 * new-WSK locally. Only WSK-encrypted pages are returned (encrypted_under_wsk =
 * true); per-page (selective) pages are not rekeyed by the workspace flow.
 *
 * Ships ONLY ciphertext (`content_encrypted`) — never the WSK or plaintext.
 * The existing `/encryption-bundle` route can't serve these because it keys
 * off per-page wrapped-DEK rows, which WSK pages don't have.
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { id: workspaceId } = await params;
    const ctx = await requireRole('owner');
    if (ctx.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const db = getDb();
    const rows = await db
      .select({ id: pages.id, contentEncrypted: pages.contentEncrypted })
      .from(pages)
      .where(
        and(
          eq(pages.workspaceId, workspaceId),
          eq(pages.encryptedUnderWsk, true),
          isNull(pages.deletedAt),
        ),
      );
    return NextResponse.json(
      rows
        .filter((r) => r.contentEncrypted != null)
        .map((r) => ({
          pageId: r.id,
          contentEncrypted: Buffer.from(r.contentEncrypted as Buffer).toString('base64'),
        })),
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}
