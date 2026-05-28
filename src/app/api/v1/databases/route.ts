import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { pageResult, parseListQuery } from '@/lib/api/pagination';
import { withApiKey } from '@/lib/api/rate-limit';
import { HttpError, hasMinRole, requireWorkspace } from '@/lib/auth/require-role';
import { createDatabase } from '@/lib/databases/create';
import { CreateDatabaseRequest } from '@/lib/schemas/databases';

export const GET = withApiKey(async (req, ctx) => {
  const ws = requireWorkspace(ctx);
  const { limit, cursor } = parseListQuery(new URL(req.url));
  const db = getDb();
  const rows = await db
    .select({
      id: schema.databases.id,
      name: schema.databases.name,
      pageId: schema.databases.pageId,
      createdAt: schema.databases.createdAt,
    })
    .from(schema.databases)
    .where(
      and(
        eq(schema.databases.workspaceId, ws.workspaceId),
        isNull(schema.databases.archivedAt),
        cursor
          ? or(
              lt(schema.databases.createdAt, new Date(cursor.createdAt)),
              and(
                eq(schema.databases.createdAt, new Date(cursor.createdAt)),
                lt(schema.databases.id, cursor.id),
              ),
            )
          : sql`true`,
      ),
    )
    .orderBy(desc(schema.databases.createdAt), desc(schema.databases.id))
    .limit(limit + 1);
  return Response.json(pageResult(rows, limit), { status: 200 });
});

export const POST = withApiKey(async (req, ctx) => {
  const ws = requireWorkspace(ctx);
  if (!hasMinRole(ws.role, 'editor')) throw new HttpError(403, 'Requires role editor');
  const parsed = CreateDatabaseRequest.parse(await req.json().catch(() => ({})));
  const database = await createDatabase(getDb(), {
    workspaceId: ws.workspaceId,
    pageId: parsed.pageId,
    createdBy: ws.userId,
    name: parsed.name,
  });
  return Response.json(database, { status: 201 });
});
