import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { auth } from '@/lib/auth/config';
import { countRemainingRecoveryCodes, regenerateRecoveryCodes } from '@/lib/auth/two-factor';
import { getPrimaryWorkspaceId } from '@/lib/workspaces/primary';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET → how many unused recovery codes remain for the calling user. */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const remaining = await countRemainingRecoveryCodes(getDb(), session.user.id);
  return NextResponse.json({ remaining });
}

/**
 * POST → replace the recovery-code set with a fresh batch, returning plaintext
 * ONCE. Requires 2FA to be enabled (409 otherwise). The previous set is fully
 * invalidated. Audited as `mfa.recovery_codes_regenerated`.
 */
export async function POST(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const db = getDb();
  const codes = await regenerateRecoveryCodes(db, session.user.id);
  if (!codes) return NextResponse.json({ error: '2fa_not_enabled' }, { status: 409 });

  const workspaceId = await getPrimaryWorkspaceId(db, session.user.id);
  if (workspaceId) {
    await recordAudit(db, {
      workspaceId,
      actorUserId: session.user.id,
      action: 'mfa.recovery_codes_regenerated',
      targetType: 'user',
      targetId: session.user.id,
      metadata: { count: codes.length },
    });
  }

  return NextResponse.json({ recoveryCodes: codes });
}
