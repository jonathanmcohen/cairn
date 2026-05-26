import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { auth } from '@/lib/auth/config';
import { getPrimaryWorkspaceId } from '@/lib/workspaces/primary';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * DELETE /api/webauthn/credentials/:credentialId
 *
 * Removes the calling user's passkey by row id. The DELETE is double-keyed
 * on (id, userId) so cross-user attempts return 404, not a tenant leak.
 * Records `mfa.passkey_removed` audit scoped to the user's primary workspace.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ credentialId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { credentialId } = await params;
  const db = getDb();

  const deleted = await db
    .delete(schema.userWebauthnCredentials)
    .where(
      and(
        eq(schema.userWebauthnCredentials.id, credentialId),
        eq(schema.userWebauthnCredentials.userId, session.user.id),
      ),
    )
    .returning({ id: schema.userWebauthnCredentials.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const workspaceId = await getPrimaryWorkspaceId(db, session.user.id);
  if (workspaceId) {
    await recordAudit(db, {
      workspaceId,
      actorUserId: session.user.id,
      action: 'mfa.passkey_removed',
      targetType: 'webauthn_credential',
      targetId: credentialId,
      metadata: {},
    });
  }

  return NextResponse.json({ ok: true });
}
