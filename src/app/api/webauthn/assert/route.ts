import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { auth } from '@/lib/auth/config';
import { finishAssertion, WebAuthnNotConfiguredError } from '@/lib/auth/webauthn';
import { getPrimaryWorkspaceId } from '@/lib/workspaces/primary';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  response: z.object({}).passthrough(),
});

/**
 * POST /api/webauthn/assert
 *
 * Completes a step-up assertion. On success writes `cairn_stepup` cookie
 * (epoch-ms, httpOnly, signed by AUTH_SECRET via Auth.js JWT cookie infra
 * elsewhere — but since this is a cross-API hop the simplest correct
 * representation is an httpOnly Secure cookie scoped same-site strict;
 * `requireStepUp` only trusts the timestamp via the JWT callback that
 * mirrors it into the session token on the next request). The cookie is
 * not the source of truth — it is a tracker the JWT callback reads on
 * subsequent renders.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const store = await cookies();
  const expectedChallenge = store.get('cairn_wac_a')?.value;
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'missing challenge cookie' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  try {
    const result = await finishAssertion({
      userId: session.user.id,
      response: parsed.data.response as never,
      expectedChallenge,
    });
    if (!result.ok) {
      return NextResponse.json({ error: 'assertion failed' }, { status: 400 });
    }

    const stepUpAt = Date.now();

    // Audit on the user's primary workspace (best-effort).
    const db = getDb();
    const workspaceId = await getPrimaryWorkspaceId(db, session.user.id);
    if (workspaceId) {
      await recordAudit(db, {
        workspaceId,
        actorUserId: session.user.id,
        action: 'mfa.passkey_used',
        targetType: 'webauthn_credential',
        targetId: null,
        metadata: { stepUp: true },
      });
    }

    const res = NextResponse.json({ ok: true, stepUpAt });
    res.cookies.delete('cairn_wac_a');
    res.cookies.set('cairn_stepup', String(stepUpAt), {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 5 * 60, // matches STEPUP_TTL_MS
      path: '/',
    });
    return res;
  } catch (err) {
    if (err instanceof WebAuthnNotConfiguredError) {
      return NextResponse.json({ error: 'webauthn not configured' }, { status: 503 });
    }
    console.error('[webauthn/assert]', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
