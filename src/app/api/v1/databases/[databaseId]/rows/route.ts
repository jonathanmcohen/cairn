import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { pageResult, parseListQuery } from '@/lib/api/pagination';
import { withApiKey } from '@/lib/api/rate-limit';
import { HttpError, hasMinRole, type MemberRole, requireWorkspace } from '@/lib/auth/require-role';
import { getDatabaseWithMeta } from '@/lib/databases/get';
import { createRow } from '@/lib/databases/rows';
import { CreateRowRequest } from '@/lib/schemas/databases';

type Params = { params: Promise<{ databaseId: string }> };

/** Ensure the database belongs to the caller's workspace + the role is met.
 *  Cross-workspace (or missing) ids 404 — never leaking existence. */
async function requireDatabase(
  workspaceId: string,
  role: MemberRole,
  databaseId: string,
  required: MemberRole,
) {
  const meta = await getDatabaseWithMeta(getDb(), { databaseId, workspaceId });
  if (!meta || meta.database.archivedAt) throw new HttpError(404, 'Database not found');
  if (!hasMinRole(role, required)) throw new HttpError(403, `Requires role ${required}`);
}

export const GET = (req: Request, { params }: Params): Promise<Response> =>
  withApiKey(async (r, ctx) => {
    const ws = requireWorkspace(ctx);
    const { databaseId } = await params;
    await requireDatabase(ws.workspaceId, ws.role, databaseId, 'viewer');
    const { limit, cursor } = parseListQuery(new URL(r.url));
    const rows = await getDb()
      .select({
        id: schema.dbRows.id,
        databaseId: schema.dbRows.databaseId,
        createdAt: schema.dbRows.createdAt,
        updatedAt: schema.dbRows.updatedAt,
      })
      .from(schema.dbRows)
      .where(
        and(
          eq(schema.dbRows.databaseId, databaseId),
          isNull(schema.dbRows.archivedAt),
          cursor
            ? or(
                lt(schema.dbRows.createdAt, new Date(cursor.createdAt)),
                and(
                  eq(schema.dbRows.createdAt, new Date(cursor.createdAt)),
                  lt(schema.dbRows.id, cursor.id),
                ),
              )
            : sql`true`,
        ),
      )
      .orderBy(desc(schema.dbRows.createdAt), desc(schema.dbRows.id))
      .limit(limit + 1);
    return Response.json(pageResult(rows, limit), { status: 200 });
  })(req);

export const POST = (req: Request, { params }: Params): Promise<Response> =>
  withApiKey(async (r, ctx) => {
    const ws = requireWorkspace(ctx);
    const { databaseId } = await params;
    await requireDatabase(ws.workspaceId, ws.role, databaseId, 'editor');
    const parsed = CreateRowRequest.parse(await r.json().catch(() => ({})));
    const row = await createRow(getDb(), {
      databaseId,
      workspaceId: ws.workspaceId,
      createdBy: ws.userId,
      cells: parsed.cells,
    });
    return Response.json(row, { status: 201 });
  })(req);
