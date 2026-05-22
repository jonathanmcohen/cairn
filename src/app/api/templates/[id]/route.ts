import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';

/**
 * Delete a workspace template (editor+). Scoped to the active workspace, so
 * built-in (workspace_id null) and cross-workspace templates can never be
 * removed — those ids simply no-op into a 404.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { id } = await params;
    const deleted = await getDb()
      .delete(schema.templates)
      .where(and(eq(schema.templates.id, id), eq(schema.templates.workspaceId, ctx.workspaceId)))
      .returning({ id: schema.templates.id });
    if (deleted.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
