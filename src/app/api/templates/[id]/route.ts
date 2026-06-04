import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { canReadTemplate } from '@/lib/templates/access';
import { buildTemplatePreview } from '@/lib/templates/preview';

/**
 * Read-only block summary for the template preview drawer (#68/#248). Returns a
 * sanitized `{ id, name, kind, blocks }` derived from the stored payload — never
 * the full instantiable payload. Visibility is gated by `canReadTemplate`, so a
 * caller can only preview templates they could already see in the gallery
 * (public, built-in, or a workspace they're a member of); everything else 404s.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const { id } = await params;
    const db = getDb();
    const ok = await canReadTemplate(db, {
      templateId: id,
      viewerUserId: ctx.userId,
      viewerWorkspaceId: ctx.workspaceId,
    });
    if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const [tpl] = await db
      .select()
      .from(schema.templates)
      .where(eq(schema.templates.id, id))
      .limit(1);
    if (!tpl) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const preview = buildTemplatePreview(tpl.payload);
    return NextResponse.json({
      id: tpl.id,
      name: tpl.name,
      kind: preview.kind,
      blocks: preview.blocks,
    });
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
