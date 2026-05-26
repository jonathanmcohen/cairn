import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { recordAudit } from '@/lib/audit/record';
import { auth } from '@/lib/auth/config';
import { finishRegistration, WebAuthnNotConfiguredError } from '@/lib/auth/webauthn';
import { getPrimaryWorkspaceId } from '@/lib/workspaces/primary';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  // We forward the entire response object to @simplewebauthn/server; structural
  // validation (id/rawId/clientDataJSON/...) lives there. Top-level shape only.
  response: z.object({}).passthrough(),
  nickname: z.string().max(120).nullable().optional(),
});

/**
 * POST /api/webauthn/register
 *
 * Completes the registration ceremony begun by `register-options`. Reads the
 * expected challenge from the httpOnly `cairn_wac` cookie (never the body),
 * verifies the attestation, persists the credential row, records an audit
 * event scoped to the user's primary workspace.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const store = await cookies();
  const expectedChallenge = store.get('cairn_wac')?.value;
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'missing challenge cookie' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const db = getDb();
  try {
    const result = await finishRegistration({
      userId: session.user.id,
      response: parsed.data.response as never,
      expectedChallenge,
      nickname: parsed.data.nickname ?? null,
    });
    if (!result.ok) {
      // Generic 400 — never expose verifier error detail to the client.
      return NextResponse.json({ error: 'registration failed' }, { status: 400 });
    }

    const workspaceId = await getPrimaryWorkspaceId(db, session.user.id);
    if (workspaceId) {
      await recordAudit(db, {
        workspaceId,
        actorUserId: session.user.id,
        action: 'mfa.passkey_added',
        targetType: 'webauthn_credential',
        targetId: null,
        metadata: { nickname: parsed.data.nickname ?? null },
      });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.delete('cairn_wac');
    return res;
  } catch (err) {
    if (err instanceof WebAuthnNotConfiguredError) {
      return NextResponse.json({ error: 'webauthn not configured' }, { status: 503 });
    }
    console.error('[webauthn/register]', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
