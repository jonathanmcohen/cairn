import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { deleteProperty, updateProperty } from '@/lib/databases/properties';
import { errToResponse } from '@/lib/databases/route-errors';
import { NextResponse } from 'next/server';
import { z } from 'zod';

type Ctx = { params: Promise<{ databaseId: string; propId: string }> };

const PatchInput = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.unknown().optional(),
});

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { databaseId, propId } = await params;
    const parsed = PatchInput.parse(await req.json());
    const patch: { name?: string; config?: unknown } = {};
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.config !== undefined) patch.config = parsed.config;
    const prop = await updateProperty(getDb(), {
      propertyId: propId,
      databaseId,
      workspaceId: ctx.workspaceId,
      patch,
    });
    return NextResponse.json(prop);
  } catch (err) {
    return errToResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { databaseId, propId } = await params;
    await deleteProperty(getDb(), {
      propertyId: propId,
      databaseId,
      workspaceId: ctx.workspaceId,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errToResponse(err);
  }
}
