import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { withApiKey } from '@/lib/api/rate-limit';
import { HttpError, hasMinRole, type MemberRole, requireWorkspace } from '@/lib/auth/require-role';
import { getDatabaseWithMeta } from '@/lib/databases/get';
import { archiveRow, updateCells } from '@/lib/databases/rows';

type Params = { params: Promise<{ databaseId: string; rowId: string }> };

const PatchInput = z.object({
  cells: z.record(z.string(), z.unknown()),
});

/** Load a row scoped to the caller's workspace + database, enforcing a minimum
 *  role. Cross-workspace (or missing) ids 404 — never leaking existence. */
async function loadScopedRow(
  workspaceId: string,
  role: MemberRole,
  databaseId: string,
  rowId: string,
  required: MemberRole,
): Promise<schema.DbRow> {
  const meta = await getDatabaseWithMeta(getDb(), { databaseId, workspaceId });
  if (!meta || meta.database.archivedAt) throw new HttpError(404, 'Database not found');
  const [row] = await getDb()
    .select()
    .from(schema.dbRows)
    .where(and(eq(schema.dbRows.id, rowId), eq(schema.dbRows.databaseId, databaseId)))
    .limit(1);
  if (!row || row.archivedAt) throw new HttpError(404, 'Row not found');
  if (!hasMinRole(role, required)) throw new HttpError(403, `Requires role ${required}`);
  return row;
}

export const GET = (req: Request, { params }: Params): Promise<Response> =>
  withApiKey(async (_r, ctx) => {
    const ws = requireWorkspace(ctx);
    const { databaseId, rowId } = await params;
    const row = await loadScopedRow(ws.workspaceId, ws.role, databaseId, rowId, 'viewer');
    const cells = await getDb()
      .select()
      .from(schema.dbCells)
      .where(eq(schema.dbCells.rowId, rowId));
    const cellMap: Record<string, unknown> = {};
    for (const c of cells) cellMap[c.propertyId] = c.value;
    return Response.json({ row, cells: cellMap }, { status: 200 });
  })(req);

export const PATCH = (req: Request, { params }: Params): Promise<Response> =>
  withApiKey(async (r, ctx) => {
    const ws = requireWorkspace(ctx);
    const { databaseId, rowId } = await params;
    await loadScopedRow(ws.workspaceId, ws.role, databaseId, rowId, 'editor');
    const parsed = PatchInput.parse(await r.json().catch(() => ({})));
    await updateCells(getDb(), {
      rowId,
      databaseId,
      workspaceId: ws.workspaceId,
      cells: parsed.cells,
    });
    const [row] = await getDb()
      .select()
      .from(schema.dbRows)
      .where(eq(schema.dbRows.id, rowId))
      .limit(1);
    return Response.json(row, { status: 200 });
  })(req);

export const DELETE = (req: Request, { params }: Params): Promise<Response> =>
  withApiKey(async (_r, ctx) => {
    const ws = requireWorkspace(ctx);
    const { databaseId, rowId } = await params;
    await loadScopedRow(ws.workspaceId, ws.role, databaseId, rowId, 'editor');
    await archiveRow(getDb(), { rowId, databaseId, workspaceId: ws.workspaceId });
    return new Response(null, { status: 204 });
  })(req);
