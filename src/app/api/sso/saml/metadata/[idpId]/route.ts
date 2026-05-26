import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getSpMetadataXml } from '@/lib/sso/saml';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ idpId: string }> },
): Promise<Response> {
  const { idpId } = await ctx.params;
  const [idp] = await getDb()
    .select()
    .from(schema.idpConfigurations)
    .where(and(eq(schema.idpConfigurations.id, idpId), eq(schema.idpConfigurations.type, 'saml')))
    .limit(1);
  if (!idp) {
    return new Response('Not found', { status: 404 });
  }
  const xml = getSpMetadataXml(idp);
  return new Response(xml, {
    status: 200,
    headers: { 'content-type': 'application/samlmetadata+xml; charset=utf-8' },
  });
}
