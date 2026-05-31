import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { listEnabledIdps } from '@/lib/sso/enabled-idps';

export const dynamic = 'force-dynamic';

/**
 * Public, unauthenticated list of enabled IdPs for the login screen. Exposes
 * only id/type/name + the SP-initiated start path; never IdP secrets. An
 * optional `next` query param (must be a local path beginning with `/`) is
 * appended as `returnTo` so the post-login redirect lands where the user
 * intended. Non-local `next` values are dropped to prevent open redirects.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const next = url.searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  const idps = await listEnabledIdps(getDb());
  const providers = idps.map((idp) => ({
    id: idp.id,
    type: idp.type,
    name: idp.name,
    startPath: safeNext
      ? `${idp.startPath}?returnTo=${encodeURIComponent(safeNext)}`
      : idp.startPath,
  }));
  return NextResponse.json({ providers });
}
