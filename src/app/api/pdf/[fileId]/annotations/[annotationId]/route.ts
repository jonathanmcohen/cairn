import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { deleteAnnotation, updateAnnotation } from '@/lib/pdf/annotations';
import { updateAnnotationInput } from '@/lib/pdf/schema';

export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ fileId: string; annotationId: string }> };

const Uuid = z.uuid();

/**
 * PATCH — update rect / content on an annotation. Per-user isolation:
 * `updateAnnotation` only matches rows where `created_by = ctx.userId`, so
 * tampering with another user's annotation surfaces as 404.
 */
export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { fileId, annotationId } = await params;
    if (!Uuid.safeParse(fileId).success || !Uuid.safeParse(annotationId).success) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const json = await req.json();
    const parsed = updateAnnotationInput.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const db = getDb();
    const [file] = await db.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
    if (!file?.pageId) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const { ctx } = await requirePageAccess(file.pageId, 'editor');
    try {
      const updated = await updateAnnotation(db, {
        id: annotationId,
        userId: ctx.userId,
        ...parsed.data,
      });
      return NextResponse.json({ annotation: updated });
    } catch {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { fileId, annotationId } = await params;
    if (!Uuid.safeParse(fileId).success || !Uuid.safeParse(annotationId).success) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const db = getDb();
    const [file] = await db.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
    if (!file?.pageId) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const { ctx } = await requirePageAccess(file.pageId, 'editor');
    try {
      await deleteAnnotation(db, { id: annotationId, userId: ctx.userId });
      return new NextResponse(null, { status: 204 });
    } catch {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
  } catch (err) {
    return errorToResponse(err);
  }
}

function errorToResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : 'unknown';
  return NextResponse.json({ error: message }, { status: 500 });
}
