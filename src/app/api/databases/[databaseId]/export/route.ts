import { eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { getAuthContext } from '@/lib/auth/require-role';
import { databaseToCsv, databaseToJson } from '@/lib/export/renderers';

type Ctx = { params: Promise<{ databaseId: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!ctx.workspaceId) return NextResponse.json({ error: 'no workspace' }, { status: 400 });

  const { databaseId } = await params;
  // Match the convention in requirePageAccess: malformed uuids → clean 404
  // (uuid casts would otherwise raise a 500).
  if (!UUID_RE.test(databaseId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const db = getDb();
  const [dbRow] = await db
    .select()
    .from(schema.databases)
    .where(eq(schema.databases.id, databaseId))
    .limit(1);
  if (!dbRow || dbRow.workspaceId !== ctx.workspaceId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const properties = await db
    .select()
    .from(schema.dbProperties)
    .where(eq(schema.dbProperties.databaseId, databaseId));
  const rows = await db
    .select()
    .from(schema.dbRows)
    .where(eq(schema.dbRows.databaseId, databaseId));

  const rowIds = rows.map((r) => r.id);
  const cells =
    rowIds.length > 0
      ? await db.select().from(schema.dbCells).where(inArray(schema.dbCells.rowId, rowIds))
      : [];

  const cellsByRow = new Map<string, Record<string, unknown>>();
  for (const r of rows) cellsByRow.set(r.id, {});
  for (const c of cells) {
    const m = cellsByRow.get(c.rowId);
    if (m) m[c.propertyId] = c.value;
  }

  const bundle = {
    id: dbRow.id,
    name: dbRow.name,
    properties: properties.map((p) => ({ id: p.id, name: p.name, type: p.type as string })),
    rows: rows.map((r) => ({ id: r.id, cells: cellsByRow.get(r.id) ?? {} })),
  };

  const format = new URL(req.url).searchParams.get('format') ?? 'csv';
  const safeName = dbRow.name.replace(/[^\w.-]+/g, '_').slice(0, 80) || dbRow.id;

  if (format === 'csv') {
    return new NextResponse(databaseToCsv(bundle), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${safeName}.csv"`,
      },
    });
  }
  if (format === 'json') {
    return new NextResponse(JSON.stringify(databaseToJson(bundle), null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${safeName}.json"`,
      },
    });
  }
  return NextResponse.json({ error: 'unsupported format' }, { status: 400 });
}
