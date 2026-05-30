import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { signLoginTicket } from '@/lib/auth/passkey-ticket';
import { finishLoginAssertion, WebAuthnNotConfiguredError } from '@/lib/auth/webauthn';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  // Forwarded wholesale to @simplewebauthn/server; structural validation lives there.
  response: z.object({}).passthrough(),
});

const TICKET_TTL_MS = 2 * 60 * 1000;

/**
 * POST /api/webauthn/login-verify
 *
 * Unauthenticated. Completes the login ceremony begun by `login-options`:
 * reads the expected challenge from the httpOnly `cairn_wac_l` cookie (never
 * the body), verifies the assertion, and on success returns a short-TTL signed
 * login ticket the browser hands to `signIn('passkey', { ticket })`. The ticket
 * — not the assertion — is what the auth provider trusts, so the secret stays
 * server-side. Failures answer a generic 400.
 */
export async function POST(req: Request): Promise<Response> {
  const store = await cookies();
  const expectedChallenge = store.get('cairn_wac_l')?.value;
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'missing challenge cookie' }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  try {
    const result = await finishLoginAssertion({
      response: parsed.data.response as never,
      expectedChallenge,
    });
    if (!result.ok) {
      return NextResponse.json({ error: 'login failed' }, { status: 400 });
    }
    const ticket = signLoginTicket(result.userId, env().AUTH_SECRET, TICKET_TTL_MS);
    const res = NextResponse.json({ ticket });
    res.cookies.delete('cairn_wac_l');
    return res;
  } catch (err) {
    if (err instanceof WebAuthnNotConfiguredError) {
      return NextResponse.json({ error: 'webauthn not configured' }, { status: 503 });
    }
    console.error('[webauthn/login-verify]', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
