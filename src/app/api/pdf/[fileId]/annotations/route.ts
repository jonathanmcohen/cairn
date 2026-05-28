import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { HttpError } from '@/lib/auth/require-role';
import { requirePageAccess } from '@/lib/pages/access';
import { createAnnotation, listAnnotations } from '@/lib/pdf/annotations';
import { createAnnotationInput } from '@/lib/pdf/schema';

export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ fileId: string }> };

const FileId = z.uuid();

/**
 * GET — return the caller's annotations for the given file. Access is gated by
 * `requirePageAccess` against the file's owning page; cross-workspace fetches
 * resolve to 404 (matching the convention for pages). v0.9.0 G3 P17.
 */
export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { fileId } = await params;
    if (!FileId.safeParse(fileId).success) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const db = getDb();
    const [file] = await db.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
    if (!file?.pageId) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const { ctx } = await requirePageAccess(file.pageId, 'viewer');
    const annotations = await listAnnotations(db, { fileId, userId: ctx.userId });
    return NextResponse.json({ annotations });
  } catch (err) {
    return errorToResponse(err);
  }
}

/**
 * POST — create an annotation. Editor role is required against the file's
 * owning page; per-user isolation is enforced at the helper layer (the
 * resulting row is stamped with `created_by = ctx.userId` regardless of any
 * client-supplied value).
 */
export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { fileId } = await params;
    if (!FileId.safeParse(fileId).success) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const json = await req.json();
    const parsed = createAnnotationInput.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    if (parsed.data.fileId !== fileId) {
      return NextResponse.json({ error: 'file id mismatch' }, { status: 400 });
    }
    const db = getDb();
    const [file] = await db.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
    if (!file?.pageId) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (file.pageId !== parsed.data.pageId) {
      return NextResponse.json({ error: 'page id mismatch' }, { status: 400 });
    }
    const { ctx } = await requirePageAccess(parsed.data.pageId, 'editor');
    const created = await createAnnotation(db, { ...parsed.data, createdBy: ctx.userId });
    return NextResponse.json({ annotation: created }, { status: 201 });
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
