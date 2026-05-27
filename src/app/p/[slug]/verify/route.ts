import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/lib/audit/record';
import { env } from '@/lib/env';
import { verifyShareAccess } from '@/lib/pages/share';
import { cookieNameFor, issueAccessCookieValue } from '@/lib/pages/share-cookie';

type RouteCtx = { params: Promise<{ slug: string }> };

/**
 * Default access TTL: 5 minutes, capped to the page's own expiry when sooner.
 *
 * v0.9.0 G6 P33 — narrowed from 12 h to 5 min so a shared-link unlock doesn't
 * leave a long-lived cookie that survives the viewer closing their tab.
 * Public viewers re-enter the password each time they return after the gap.
 */
const DEFAULT_TTL_SECONDS = 5 * 60;

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

  // v0.9.0 G6 P33 — record a per-unlock audit row. actorUserId is null because
  // the viewer is anonymous; we record the slug (already public) but never
  // the password. Failures during audit insert MUST NOT block the unlock —
  // the gate has already passed — so wrap in try/catch.
  try {
    await recordAudit(db, {
      workspaceId: page.workspaceId,
      actorUserId: null,
      action: 'share.password_used',
      targetType: 'page',
      targetId: page.id,
      metadata: { slug },
    });
  } catch {
    // Best-effort: never fail the user unlock if the audit insert errors.
  }

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
