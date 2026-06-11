import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { env } from '@/lib/env';
import { BrandError, getWorkspaceBrand, setWorkspaceBrand } from '@/lib/workspaces/brand';

const IdSchema = z.uuid();

// Mirror of the workspace-settings route's PATCH shape conventions: every
// field optional; null clears. Color length is bounded before the lib's
// stricter '#rrggbb' validation runs.
const Body = z.object({
  logoFileId: z.uuid().nullable().optional(),
  primaryColor: z.string().max(16).nullable().optional(),
});

/**
 * v0.10.0 F1 — workspace brand (logo + primary color).
 * GET: any member (viewer+). PATCH: admin/owner. Both 404 when the URL id is
 * not the caller's ACTIVE workspace — same existence-hiding convention as the
 * sibling settings route.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const workspaceId = IdSchema.parse(id);
    const ctx = await requireRole('viewer');
    if (ctx.workspaceId !== workspaceId) {
      throw new HttpError(404, 'Workspace not found');
    }
    const brand = await getWorkspaceBrand(getDb(), workspaceId, { secret: env().AUTH_SECRET });
    return NextResponse.json(brand, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const workspaceId = IdSchema.parse(id);
    const ctx = await requireRole('admin');
    if (ctx.workspaceId !== workspaceId) {
      throw new HttpError(404, 'Workspace not found');
    }
    const body = Body.parse(await req.json().catch(() => ({})));
    const db = getDb();
    await setWorkspaceBrand(db, {
      workspaceId,
      actorUserId: ctx.userId,
      logoFileId: body.logoFileId,
      primaryColor: body.primaryColor,
    });
    const brand = await getWorkspaceBrand(db, workspaceId, { secret: env().AUTH_SECRET });
    return NextResponse.json(brand, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown): Response {
  if (err instanceof BrandError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
  }
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'validation', issues: err.issues }, { status: 400 });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'unknown' },
    { status: 500 },
  );
}
