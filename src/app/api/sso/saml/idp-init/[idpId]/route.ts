import { NextResponse } from 'next/server';
import { handleSamlResponse, readSamlResponse } from '@/app/api/sso/saml/callback/[idpId]/route';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ idpId: string }> },
): Promise<Response> {
  const { idpId } = await ctx.params;
  const body = await readSamlResponse(req);
  if (!body) return NextResponse.json({ error: 'Missing SAMLResponse' }, { status: 400 });
  return handleSamlResponse(idpId, body);
}
