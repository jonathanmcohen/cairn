import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';
import { verifyShareAccess } from '@/lib/pages/share';
import { cookieNameFor, issueAccessCookieValue } from '@/lib/pages/share-cookie';

type RouteCtx = { params: Promise<{ slug: string }> };

/** Default access TTL: 12 hours, capped to the page's own expiry when sooner. */
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  const { slug } = await params;

  let password = '';
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body.password === 'string') password = body.password;
  } catch {
    // ignore malformed body → falls through to 401
  }

  const db = getDb();
  const [page] = await db
    .select()
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.publicSlug, slug),
        eq(schema.pages.published, true),
        isNull(schema.pages.deletedAt),
      ),
    )
    .limit(1);

  // Identical 401 for unknown page / no password set / wrong password — no leak.
  if (!page?.linkPasswordHash || !(await verifyShareAccess(page, password))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (page.expiresAt && page.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  let expiresAt = nowSec + DEFAULT_TTL_SECONDS;
  if (page.expiresAt) {
    expiresAt = Math.min(expiresAt, Math.floor(page.expiresAt.getTime() / 1000));
  }
  const maxAge = Math.max(0, expiresAt - nowSec);

  const value = issueAccessCookieValue({
    pageId: page.id,
    expiresAt,
    secret: env().AUTH_SECRET,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieNameFor(page.id), value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/p/${slug}`,
    maxAge,
  });
  return res;
}
