/**
 * v0.9.0 G2 P14 — Page lock API.
 *
 * - `POST /api/pages/[pageId]/lock` — acquire (or refresh) a lock. Requires
 *   `editor`. Optional `lockedUntil` body field (ISO timestamp) sets an
 *   auto-unlock cutoff; omitted/null means manual-unlock-only.
 * - `DELETE /api/pages/[pageId]/lock` — release. Self-unlock works for any
 *   editor who holds the lock; an admin can pass `adminOverride: true` to
 *   force-clear someone else's lock (records `page.unlock_overridden_by_admin`).
 *   Non-locker, non-admin callers get 403 `PageLocked`.
 *
 * Same generic 400/403/404 surface as the rest of the page API; cross-workspace
 * page ids fall through to the 404 emitted by `requirePageAccess` (existence
 * hiding).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, hasMinRole } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { lockPage, unlockPage } from '@/lib/pages/lock';

type RouteCtx = { params: Promise<{ pageId: string }> };

const lockBody = z
  .object({
    lockedUntil: z.string().datetime().nullable().optional(),
  })
  .strict();

const unlockBody = z
  .object({
    adminOverride: z.boolean().default(false),
  })
  .strict();

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const body = lockBody.parse(await req.json().catch(() => ({})));
    await lockPage(getDb(), {
      pageId,
      byUserId: ctx.userId,
      workspaceId: ctx.workspaceId,
      lockedUntil: body.lockedUntil ? new Date(body.lockedUntil) : null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    // Body may be empty on a plain "Unlock". `req.json()` throws on an empty
    // body — degrade to the defaults rather than 400ing the user.
    const raw = (await req.json().catch(() => ({}))) as unknown;
    const body = unlockBody.parse(raw);
    // Caller can request the admin-override path, but we only honor it when
    // their resolved role actually meets the bar. A non-admin asking for an
    // override is silently downgraded to the self-unlock path, which then
    // 403s if they're not the locker — exactly the right behavior.
    const effectiveOverride = body.adminOverride && hasMinRole(ctx.role, 'admin');
    await unlockPage(getDb(), {
      pageId,
      byUserId: ctx.userId,
      workspaceId: ctx.workspaceId,
      adminOverride: effectiveOverride,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    // v0.9.0 G2 P14 review — PageLockedError extends HttpError; carry its
    // optional `code`/`state` through when present.
    const body: { error: string; code?: string; state?: unknown } = { error: err.message };
    const maybe = err as { code?: string; state?: unknown };
    if (typeof maybe.code === 'string') body.code = maybe.code;
    if (maybe.state !== undefined) body.state = maybe.state;
    return NextResponse.json(body, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  throw err;
}
