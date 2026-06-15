import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { auth } from '@/lib/auth/config';
import { revokeSingleSession } from '@/lib/auth/session-store';
import { getPrimaryWorkspaceId } from '@/lib/workspaces/primary';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * v0.10.3 Q-2 — POST → revoke ONE of the caller's sessions by id. The store
 * scopes the revoke to the authenticated user, so a caller can only sign out
 * their own devices; an unknown/foreign/already-revoked id is a 404 no-op.
 * Audited as `auth.sessions_revoked` with `scope: "single"`.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;
  const { sessionId } = await params;

  const db = getDb();
  const revoked = await revokeSingleSession(db, userId, sessionId);
  if (!revoked) {
    // Nothing revoked: either not the caller's session or already gone. 404
    // (not 403) so we never confirm the existence of another user's session id.
    return NextResponse.json({ revoked: false }, { status: 404 });
  }

  const workspaceId = await getPrimaryWorkspaceId(db, userId);
  if (workspaceId) {
    await recordAudit(db, {
      workspaceId,
      actorUserId: userId,
      action: 'auth.sessions_revoked',
      targetType: 'user',
      targetId: userId,
      metadata: { scope: 'single', revoked: 1, sessionId },
    });
  }

  return NextResponse.json({ revoked: true });
}
