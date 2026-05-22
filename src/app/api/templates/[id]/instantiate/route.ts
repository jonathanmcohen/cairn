import { and, eq, isNull, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { instantiateTemplate } from '@/lib/templates/instantiate';

/**
 * Instantiate a template into the active workspace (editor+). Built-in
 * (workspace_id null) templates are usable from anywhere; workspace templates
 * only by their own workspace — cross-workspace ids return 404.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { id } = await params;
    const db = getDb();

    const [tpl] = await db
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(
        and(
          eq(schema.templates.id, id),
          or(
            isNull(schema.templates.workspaceId),
            eq(schema.templates.workspaceId, ctx.workspaceId),
          ),
        ),
      )
      .limit(1);
    if (!tpl) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const result = await instantiateTemplate(db, {
      templateId: id,
      targetWorkspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
    });
    return NextResponse.json(
      { rootPageId: result.rootPageId ?? null, rootDatabaseId: result.rootDatabaseId ?? null },
      { status: 201 },
    );
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
