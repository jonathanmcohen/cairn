import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { beginAssertion, WebAuthnNotConfiguredError } from '@/lib/auth/webauthn';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  try {
    const out = await beginAssertion({ userId: session.user.id });
    const res = NextResponse.json({ options: out.options });
    res.cookies.set('cairn_wac_a', out.expectedChallenge, {
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
    console.error('[webauthn/assert-options]', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
