import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { buildLoginRequest } from '@/lib/sso/saml';
import { signSamlState } from '@/lib/sso/saml-state';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ idpId: string }> },
): Promise<Response> {
  const { idpId } = await ctx.params;
  const [idp] = await getDb()
    .select()
    .from(schema.idpConfigurations)
    .where(
      and(
        eq(schema.idpConfigurations.id, idpId),
        eq(schema.idpConfigurations.type, 'saml'),
        eq(schema.idpConfigurations.enabled, true),
      ),
    )
    .limit(1);
  if (!idp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const { requestId, url } = await buildLoginRequest(idp);

    const reqUrl = new URL(req.url);
    const returnTo = reqUrl.searchParams.get('returnTo') ?? '/';
    const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/';

    const stateValue = await signSamlState({
      idpId,
      requestId,
      returnTo: safeReturnTo,
    });

    const jar = await cookies();
    jar.set(`cairn_saml_state_${idpId}`, stateValue, {
      httpOnly: true,
      sameSite: 'lax',
      secure: (process.env.NEXTAUTH_URL ?? '').startsWith('https://'),
      path: '/',
      maxAge: 600,
    });

    return NextResponse.redirect(url, 302);
  } catch (err) {
    console.error('SAML init failed:', err);
    return NextResponse.json({ error: 'Failed to build SAML AuthnRequest' }, { status: 400 });
  }
}
