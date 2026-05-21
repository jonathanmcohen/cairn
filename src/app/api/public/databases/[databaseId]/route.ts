import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getDatabaseWithMeta } from '@/lib/databases/get';
import { listRows } from '@/lib/databases/rows';

type Ctx = { params: Promise<{ databaseId: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { databaseId } = await params;
  const db = getDb();

  // Authorize via the database's containing page being published + not deleted.
  // Returns the database's workspaceId only when that gate passes.
  const [row] = await db
    .select({ workspaceId: schema.databases.workspaceId })
    .from(schema.databases)
    .innerJoin(schema.pages, eq(schema.databases.pageId, schema.pages.id))
    .where(
      and(
        eq(schema.databases.id, databaseId),
        eq(schema.pages.published, true),
        isNull(schema.pages.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const meta = await getDatabaseWithMeta(db, { databaseId, workspaceId: row.workspaceId });
  if (!meta) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Default/first view's filters+sorts, same as the authenticated read path.
  const view = meta.views[0];
  const cfg = (view?.config ?? {}) as { filters?: unknown[]; sorts?: unknown[] };
  const rows = await listRows(db, {
    databaseId,
    workspaceId: row.workspaceId,
    filters: (cfg.filters ?? []) as never,
    sorts: (cfg.sorts ?? []) as never,
  });

  return NextResponse.json({ ...meta, rows });
}
