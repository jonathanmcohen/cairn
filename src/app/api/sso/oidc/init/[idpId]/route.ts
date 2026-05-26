import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { idpConfigurations } from '@/db/schema/sso';
import { buildAuthRequest } from '@/lib/sso/oidc';
import { signOidcState } from '@/lib/sso/oidc-state';

export const dynamic = 'force-dynamic';

function redirectUriFor(idpId: string): string {
  const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  return `${origin.replace(/\/$/, '')}/api/sso/oidc/callback/${idpId}`;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ idpId: string }> },
): Promise<Response> {
  const { idpId } = await ctx.params;

  const [idp] = await getDb()
    .select()
    .from(idpConfigurations)
    .where(eq(idpConfigurations.id, idpId))
    .limit(1);
  if (!idp || idp.type !== 'oidc' || !idp.enabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const returnTo = url.searchParams.get('returnTo') ?? '/';
  const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/';

  const nonce = randomUUID();
  const stateValue = await signOidcState({ idpId, nonce, returnTo: safeReturnTo });

  const authUrl = await buildAuthRequest(idp, {
    state: stateValue,
    nonce,
    redirectUri: redirectUriFor(idpId),
  });

  const jar = await cookies();
  jar.set(`cairn_oidc_state_${idpId}`, stateValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: (process.env.NEXTAUTH_URL ?? '').startsWith('https://'),
    path: '/',
    maxAge: 600,
  });

  return NextResponse.redirect(authUrl, 302);
}
