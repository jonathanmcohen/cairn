/**
 * G16 #163 — page translations linker REST surface.
 *
 * GET lists every page linked to the same canonical as `pageId`; POST links
 * `pageId` as a translation of `canonicalPageId` via `linkTranslation` (which
 * records the `page.translation_linked` audit). The lib enforces the
 * self-link, cross-workspace, and not-found guards by throwing plain `Error`s;
 * those map to 400 here (HttpError from `requirePageAccess` keeps its own
 * status — 403/404).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { linkTranslation, listLinkedTranslations } from '@/lib/pages/translations';

type RouteCtx = { params: Promise<{ pageId: string }> };

const PostSchema = z
  .object({
    canonicalPageId: z.uuid(),
    locale: z.string().min(2).max(35),
  })
  .strict();

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    await requirePageAccess(pageId, 'viewer');
    const linked = await listLinkedTranslations(getDb(), { canonicalPageId: pageId });
    return NextResponse.json({
      translations: linked.map((p) => ({
        id: p.id,
        title: p.title,
        locale: p.translationLocale,
      })),
    });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { pageId } = await params;
    const { ctx } = await requirePageAccess(pageId, 'editor');
    const body = PostSchema.parse((await req.json().catch(() => ({}))) as unknown);
    // The canonical's workspace match is enforced by `linkTranslation` (it throws
    // a plain Error for cross-workspace / not-found, mapped to 400 below). We do
    // not pre-check `requirePageAccess` on the canonical so a foreign canonical
    // surfaces as a 400 "same-workspace" error rather than a 404.
    await linkTranslation(getDb(), {
      pageId,
      canonicalPageId: body.canonicalPageId,
      locale: body.locale,
      byUserId: ctx.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  // linkTranslation throws plain Errors for self-link / cross-workspace / not-found.
  if (err instanceof Error) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  throw err;
}
