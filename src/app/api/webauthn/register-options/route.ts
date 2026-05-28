import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { beginRegistration, WebAuthnNotConfiguredError } from '@/lib/auth/webauthn';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/webauthn/register-options
 *
 * Issues a WebAuthn `PublicKeyCredentialCreationOptions` JSON the browser
 * passes to `navigator.credentials.create({...})`. The expected challenge
 * round-trips back via a short-TTL httpOnly cookie so the client cannot
 * tamper with it before calling `register`.
 */
export async function POST(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const out = await beginRegistration({
      userId: session.user.id,
      userName: session.user.email ?? session.user.id,
      userDisplayName: session.user.name ?? session.user.email ?? 'User',
    });
    const res = NextResponse.json({ options: out.options });
    // 5-min ceremony TTL — generous for slow USB authenticators, short
    // enough that a leaked cookie can't be replayed days later.
    res.cookies.set('cairn_wac', out.expectedChallenge, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 300,
      path: '/',
    });
    return res;
  } catch (err) {
    if (err instanceof WebAuthnNotConfiguredError) {
      return NextResponse.json({ error: 'webauthn not configured' }, { status: 503 });
    }
    console.error('[webauthn/register-options]', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
