import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { withApiKey } from '@/lib/api/rate-limit';
import { HttpError, hasMinRole, type MemberRole, requireWorkspace } from '@/lib/auth/require-role';
import { getDatabaseWithMeta } from '@/lib/databases/get';

type Params = { params: Promise<{ databaseId: string }> };

const PatchInput = z.object({
  name: z.string().min(1).max(200).optional(),
});

/** Load a database scoped to the caller's workspace, enforcing a minimum role.
 *  Cross-workspace (or missing) ids 404 — never leaking existence. */
async function loadScoped(
  workspaceId: string,
  role: MemberRole,
  databaseId: string,
  required: MemberRole,
) {
  const meta = await getDatabaseWithMeta(getDb(), { databaseId, workspaceId });
  if (!meta || meta.database.archivedAt) throw new HttpError(404, 'Database not found');
  if (!hasMinRole(role, required)) throw new HttpError(403, `Requires role ${required}`);
  return meta;
}

export const GET = (req: Request, { params }: Params): Promise<Response> =>
  withApiKey(async (_r, ctx) => {
    const ws = requireWorkspace(ctx);
    const { databaseId } = await params;
    const meta = await loadScoped(ws.workspaceId, ws.role, databaseId, 'viewer');
    return Response.json(meta, { status: 200 });
  })(req);

export const PATCH = (req: Request, { params }: Params): Promise<Response> =>
  withApiKey(async (r, ctx) => {
    const ws = requireWorkspace(ctx);
    const { databaseId } = await params;
    await loadScoped(ws.workspaceId, ws.role, databaseId, 'editor');
    const parsed = PatchInput.parse(await r.json().catch(() => ({})));
    const values: { name?: string } = {};
    if (parsed.name !== undefined) values.name = parsed.name;
    const [updated] = await getDb()
      .update(schema.databases)
      .set(values)
      .where(eq(schema.databases.id, databaseId))
      .returning();
    return Response.json(updated, { status: 200 });
  })(req);

export const DELETE = (req: Request, { params }: Params): Promise<Response> =>
  withApiKey(async (_r, ctx) => {
    const ws = requireWorkspace(ctx);
    const { databaseId } = await params;
    await loadScoped(ws.workspaceId, ws.role, databaseId, 'editor');
    await getDb()
      .update(schema.databases)
      .set({ archivedAt: new Date() })
      .where(eq(schema.databases.id, databaseId));
    return new Response(null, { status: 204 });
  })(req);
