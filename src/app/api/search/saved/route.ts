import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { HttpError, requireRole } from '@/lib/auth/require-role';
import { createSavedSearch, listSavedSearches } from '@/lib/search/saved';

const FiltersSchema = z
  .object({
    author: z.uuid().optional(),
    dateRange: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
    types: z.array(z.enum(['page', 'db_row'])).optional(),
    scopeDatabaseId: z.uuid().optional(),
  })
  .default({});

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  query: z.string().max(200).default(''),
  filters: FiltersSchema,
});

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const rows = await listSavedSearches(getDb(), {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });
    return NextResponse.json({ savedSearches: rows });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const parsed = CreateSchema.parse(await req.json());
    const row = await createSavedSearch(getDb(), {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      name: parsed.name,
      query: parsed.query,
      filters: parsed.filters,
    });
    return NextResponse.json(row, { status: 201 });
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
