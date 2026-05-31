import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { auth } from '@/lib/auth/config';
import { revokeAllSessions } from '@/lib/auth/session-store';
import { getPrimaryWorkspaceId } from '@/lib/workspaces/primary';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BodySchema = z.object({ scope: z.enum(['others', 'all']).optional() });

/**
 * POST → revoke the caller's sessions. Default ("others") keeps the current
 * device signed in; `{ scope: "all" }` revokes every session including this
 * one. Audited as `auth.sessions_revoked`.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;
  const sid = (session as { sid?: string }).sid;

  let scope: 'others' | 'all' = 'others';
  try {
    const raw = await req.json();
    scope = BodySchema.parse(raw).scope ?? 'others';
  } catch {
    // Empty/invalid body → default to "others".
  }

  const db = getDb();
  const revoked = await revokeAllSessions(db, userId, {
    exceptSid: scope === 'all' ? undefined : sid,
  });

  const workspaceId = await getPrimaryWorkspaceId(db, userId);
  if (workspaceId) {
    await recordAudit(db, {
      workspaceId,
      actorUserId: userId,
      action: 'auth.sessions_revoked',
      targetType: 'user',
      targetId: userId,
      metadata: { scope, revoked },
    });
  }

  return NextResponse.json({ revoked, scope });
}
