import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { createConnector } from '@/lib/connectors/manage';

const Body = z.object({
  databaseId: z.uuid(),
  kind: z.enum(['google_sheets', 'airtable', 'csv']),
});

/** Create a disabled database connector for a database in the caller's workspace. */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireRole('admin');
    const { databaseId, kind } = Body.parse(await req.json());

    // The database must belong to the caller's workspace — createConnector itself
    // does not check this, so guard here (404 to avoid leaking existence).
    const [database] = await getDb()
      .select({ id: schema.databases.id })
      .from(schema.databases)
      .where(
        and(eq(schema.databases.id, databaseId), eq(schema.databases.workspaceId, ctx.workspaceId)),
      )
      .limit(1);
    if (!database) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // The unique(database_id) index enforces one connector per database — surface
    // a friendly 409 rather than a raw constraint error.
    const conn = await createConnector(getDb(), {
      workspaceId: ctx.workspaceId,
      databaseId,
      kind,
      createdBy: ctx.userId,
    }).catch((err: unknown) => {
      if (err instanceof Error && /unique|duplicate/i.test(err.message)) return null;
      throw err;
    });
    if (!conn) return NextResponse.json({ error: 'already connected' }, { status: 409 });
    return NextResponse.json({ id: conn.id }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    if (err instanceof HttpError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'internal error' },
      { status: 500 },
    );
  }
}
