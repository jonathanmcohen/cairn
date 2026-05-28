import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { userKeypairs, workspaceMembers } from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';

/**
 * v0.9.0 G1 P6 — GET /api/workspaces/[id]/keypair-roster.
 *
 * Returns the public keys of every workspace member with a registered E2E
 * keypair, for the calling client to wrap a per-page DEK against. Only the
 * PUBLIC key is returned; the encryptedPrivateKey + kdf material stay
 * server-side and are never shipped over the wire from this endpoint.
 *
 * Auth: caller must be at least a viewer in the URL workspace (matches
 * who can read the page they intend to encrypt). The route does NOT check
 * that `workspaceId` in the URL matches the active workspace — `requireRole`
 * already pins to the active workspace, so we just cross-check here.
 */
export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { id: workspaceId } = await params;
    const ctx = await requireRole('viewer');
    // Cross-workspace request → 404 (existence-leak guard).
    if (ctx.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const db = getDb();
    const rows = await db
      .select({
        memberUserId: workspaceMembers.userId,
        publicKey: userKeypairs.publicKey,
      })
      .from(workspaceMembers)
      .innerJoin(userKeypairs, eq(userKeypairs.userId, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    return NextResponse.json(
      rows.map((r) => ({
        memberUserId: r.memberUserId,
        // ONLY the public key. Private/encrypted material never leaves the
        // server via this endpoint (retro lesson: strip key material from
        // any admin/server response — only ciphertext + wrapped DEKs go to
        // clients).
        publicKey: Buffer.from(r.publicKey).toString('base64'),
      })),
    );
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
