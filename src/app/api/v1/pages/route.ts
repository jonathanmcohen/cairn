import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { pageResult, parseListQuery } from '@/lib/api/pagination';
import { withApiKey } from '@/lib/api/rate-limit';
import { HttpError, hasMinRole, requireWorkspace } from '@/lib/auth/require-role';
import { createPage } from '@/lib/pages/create';

const CreateInput = z.object({
  parentId: z.uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  icon: z.string().max(8).optional(),
});

export const GET = withApiKey(async (req, ctx) => {
  const ws = requireWorkspace(ctx);
  const { limit, cursor } = parseListQuery(new URL(req.url));
  const db = getDb();
  const rows = await db
    .select({
      id: schema.pages.id,
      title: schema.pages.title,
      parentId: schema.pages.parentId,
      icon: schema.pages.icon,
      createdAt: schema.pages.createdAt,
    })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.workspaceId, ws.workspaceId),
        isNull(schema.pages.deletedAt),
        cursor
          ? or(
              lt(schema.pages.createdAt, new Date(cursor.createdAt)),
              and(
                eq(schema.pages.createdAt, new Date(cursor.createdAt)),
                lt(schema.pages.id, cursor.id),
              ),
            )
          : sql`true`,
      ),
    )
    .orderBy(desc(schema.pages.createdAt), desc(schema.pages.id))
    .limit(limit + 1);
  return Response.json(pageResult(rows, limit), { status: 200 });
});

export const POST = withApiKey(async (req, ctx) => {
  const ws = requireWorkspace(ctx);
  if (!hasMinRole(ws.role, 'editor')) throw new HttpError(403, 'Requires role editor');
  const parsed = CreateInput.parse(await req.json().catch(() => ({})));
  const page = await createPage(getDb(), {
    workspaceId: ws.workspaceId,
    createdBy: ws.userId,
    parentId: parsed.parentId,
    title: parsed.title,
    icon: parsed.icon ?? null,
  });
  return Response.json(page, { status: 201 });
});
