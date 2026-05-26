import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { buildLoginRequest } from '@/lib/sso/saml';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
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
    const { url } = await buildLoginRequest(idp);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to build SAML AuthnRequest', detail: String(err) },
      { status: 500 },
    );
  }
}
