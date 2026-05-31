import { NextResponse } from 'next/server';
import { z } from 'zod';
import { beginLoginAssertion, WebAuthnNotConfiguredError } from '@/lib/auth/webauthn';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ email: z.email() });

/**
 * POST /api/webauthn/login-options
 *
 * Unauthenticated. Issues a WebAuthn assertion-options JSON for the passkeys
 * registered to the given email. Returns 204 (no options, no cookie) when the
 * email is unknown or has no passkeys, so a caller cannot distinguish the two
 * (no account enumeration). On success the expected challenge round-trips via
 * a 5-min httpOnly `cairn_wac_l` cookie the client cannot read or tamper with.
 */
export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  try {
    const out = await beginLoginAssertion({ email: parsed.data.email });
    if (!out) return new NextResponse(null, { status: 204 });
    const res = NextResponse.json({ options: out.options });
    res.cookies.set('cairn_wac_l', out.expectedChallenge, {
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
    console.error('[webauthn/login-options]', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
