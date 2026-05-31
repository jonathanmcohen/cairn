import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { workspaceEncryptionKeys } from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';

/**
 * v0.9.7 G21 (#168) — GET /api/workspaces/[id]/e2e/my-wsk.
 *
 * Returns the CALLER's own wrapped workspace-key (WSK) at the current key
 * version, so the rekey client can unwrap it with their private key and
 * recover the current WSK in-browser. Self-scoped: only the caller's own
 * `workspace_encryption_keys` row is ever read or returned. Returns 404 when
 * the caller has no wrapped row (not yet covered by the current WSK).
 *
 * Only the wrapped (ciphertext) WSK is shipped — the server never holds the
 * unwrapped WSK.
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { id: workspaceId } = await params;
    const ctx = await requireRole('viewer');
    if (ctx.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const db = getDb();
    const [row] = await db
      .select({
        wrappedWsk: workspaceEncryptionKeys.wrappedWsk,
        keyVersion: workspaceEncryptionKeys.keyVersion,
      })
      .from(workspaceEncryptionKeys)
      .where(
        and(
          eq(workspaceEncryptionKeys.workspaceId, workspaceId),
          eq(workspaceEncryptionKeys.memberUserId, ctx.userId),
        ),
      )
      .orderBy(desc(workspaceEncryptionKeys.keyVersion))
      .limit(1);
    if (!row) {
      return NextResponse.json({ error: 'no wrapped WSK for caller' }, { status: 404 });
    }
    return NextResponse.json({
      wrappedWsk: Buffer.from(row.wrappedWsk).toString('base64'),
      keyVersion: row.keyVersion,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
}
