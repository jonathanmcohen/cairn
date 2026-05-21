import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { errToResponse } from '@/lib/databases/route-errors';
import { createRow, listRows } from '@/lib/databases/rows';

type Ctx = { params: Promise<{ databaseId: string }> };

const CreateInput = z.object({
  cells: z.record(z.string(), z.unknown()).optional(),
});

const FilterArray = z
  .array(z.object({ propertyId: z.string().uuid(), op: z.string(), value: z.unknown() }))
  .default([]);
const SortArray = z
  .array(z.object({ propertyId: z.string().uuid(), direction: z.enum(['asc', 'desc']) }))
  .default([]);

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { databaseId } = await params;
    const parsed = CreateInput.parse(await req.json());
    const row = await createRow(getDb(), {
      databaseId,
      workspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
      cells: parsed.cells,
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return errToResponse(err);
  }
}

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const { databaseId } = await params;
    const url = new URL(req.url);
    const filtersRaw = url.searchParams.get('filters');
    const sortsRaw = url.searchParams.get('sorts');
    const parsedFilters = FilterArray.parse(filtersRaw ? JSON.parse(filtersRaw) : []);
    const sorts = SortArray.parse(sortsRaw ? JSON.parse(sortsRaw) : []);
    const filters = parsedFilters.map((f) => ({
      propertyId: f.propertyId,
      op: f.op,
      value: f.value,
    }));
    const rows = await listRows(getDb(), {
      databaseId,
      workspaceId: ctx.workspaceId,
      filters,
      sorts,
    });
    return NextResponse.json({ rows });
  } catch (err) {
    return errToResponse(err);
  }
}
