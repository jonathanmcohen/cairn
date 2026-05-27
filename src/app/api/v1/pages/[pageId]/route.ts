import { z } from 'zod';
import { getDb } from '@/db/client';
import { withApiKey } from '@/lib/api/rate-limit';
import { HttpError, hasMinRole, type MemberRole, requireWorkspace } from '@/lib/auth/require-role';
import { softDeletePage } from '@/lib/pages/delete';
import { getPage } from '@/lib/pages/get';
import { updatePage } from '@/lib/pages/update';

type Params = { params: Promise<{ pageId: string }> };

const PatchInput = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.unknown().optional(),
  icon: z.string().max(8).nullable().optional(),
});

/** Load a page scoped to the caller's workspace, enforcing a minimum role.
 *  Cross-workspace (or missing) ids 404 — never leaking existence. */
async function loadScoped(
  workspaceId: string,
  role: MemberRole,
  pageId: string,
  required: MemberRole,
) {
  const page = await getPage(getDb(), { pageId, workspaceId });
  if (!page) throw new HttpError(404, 'Page not found');
  if (!hasMinRole(role, required)) throw new HttpError(403, `Requires role ${required}`);
  return page;
}

export const GET = (req: Request, { params }: Params): Promise<Response> =>
  withApiKey(async (_r, ctx) => {
    const ws = requireWorkspace(ctx);
    const { pageId } = await params;
    const page = await loadScoped(ws.workspaceId, ws.role, pageId, 'viewer');
    return Response.json(page, { status: 200 });
  })(req);

export const PATCH = (req: Request, { params }: Params): Promise<Response> =>
  withApiKey(async (r, ctx) => {
    const ws = requireWorkspace(ctx);
    const { pageId } = await params;
    await loadScoped(ws.workspaceId, ws.role, pageId, 'editor');
    const parsed = PatchInput.parse(await r.json().catch(() => ({})));
    const page = await updatePage(getDb(), {
      pageId,
      workspaceId: ws.workspaceId,
      patch: parsed,
      // v0.9.0 G2 P14 — page-lock gate. PAT-driven write requests run as the
      // PAT's owning user; admin override flows from the same role check.
      byUserId: ws.userId,
      adminOverride: hasMinRole(ws.role, 'admin'),
    });
    return Response.json(page, { status: 200 });
  })(req);

export const DELETE = (req: Request, { params }: Params): Promise<Response> =>
  withApiKey(async (_r, ctx) => {
    const ws = requireWorkspace(ctx);
    const { pageId } = await params;
    await loadScoped(ws.workspaceId, ws.role, pageId, 'editor');
    await softDeletePage(getDb(), {
      pageId,
      workspaceId: ws.workspaceId,
      actorUserId: ws.userId,
      adminOverride: hasMinRole(ws.role, 'admin'),
    });
    return new Response(null, { status: 204 });
  })(req);
