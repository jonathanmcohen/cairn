import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { TEMPLATE_VISIBILITIES } from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { savePageAsTemplate } from '@/lib/templates/save';

export const runtime = 'nodejs';

const BodySchema = z.object({
  pageId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  visibility: z.enum(TEMPLATE_VISIBILITIES),
});

/**
 * v0.9.0 G4 P25 — Save a page as a template with the chosen visibility tier.
 *
 * Caller must be signed in (401), hold at least `editor` role on their active
 * workspace (403), and have view access on the source page (404 — never leak
 * page existence across workspaces). The visibility is validated against the
 * `templates_visibility_check` constraint shape via Zod before the heavy
 * capture walk.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('editor');

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return NextResponse.json({ error: 'invalid input' }, { status: 400 });
    }

    // requirePageAccess gates cross-workspace + missing page with a 404 by
    // contract (never 403 for cross-workspace — would leak existence).
    await requirePageAccess(body.pageId, 'viewer');

    const tpl = await savePageAsTemplate(getDb(), {
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      rootPageId: body.pageId,
      name: body.name,
      visibility: body.visibility,
    });

    return NextResponse.json({ templateId: tpl.id });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
