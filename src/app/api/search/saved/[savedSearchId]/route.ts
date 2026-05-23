import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { deleteSavedSearch, updateSavedSearch } from '@/lib/search/saved';

const FiltersSchema = z
  .object({
    author: z.uuid().optional(),
    dateRange: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
    types: z.array(z.enum(['page', 'db_row'])).optional(),
    scopeDatabaseId: z.uuid().optional(),
  })
  .optional();

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  query: z.string().max(200).optional(),
  filters: FiltersSchema,
});

type RouteCtx = { params: Promise<{ savedSearchId: string }> };

export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const { savedSearchId } = await params;
    const parsed = PatchSchema.parse(await req.json());
    try {
      const row = await updateSavedSearch(getDb(), {
        id: savedSearchId,
        userId: ctx.userId,
        ...parsed,
      });
      return NextResponse.json(row);
    } catch {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const { savedSearchId } = await params;
    try {
      await deleteSavedSearch(getDb(), { id: savedSearchId, userId: ctx.userId });
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
