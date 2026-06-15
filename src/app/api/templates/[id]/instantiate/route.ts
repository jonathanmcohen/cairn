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
  req: Request,
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

    // v0.10.3 Q-4 — optional destination parent. Default (no/empty body) keeps
    // the prior behavior: graft at the sidebar root. A supplied parentId must be
    // a live page in the CALLER's workspace, so a template can't be nested under
    // another workspace's page (or a trashed one); otherwise 400.
    let parentId: string | null = null;
    const body = (await req.json().catch(() => null)) as { parentId?: unknown } | null;
    if (body && typeof body.parentId === 'string' && body.parentId.length > 0) {
      parentId = body.parentId;
    }
    if (parentId) {
      const [parent] = await db
        .select({ id: schema.pages.id })
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, parentId),
            eq(schema.pages.workspaceId, ctx.workspaceId),
            isNull(schema.pages.deletedAt),
          ),
        )
        .limit(1);
      if (!parent) return NextResponse.json({ error: 'invalid_parent' }, { status: 400 });
    }

    const result = await instantiateTemplate(db, {
      templateId: id,
      targetWorkspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
      parentId,
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
