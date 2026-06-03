import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { errToResponse } from '@/lib/databases/route-errors';
import { archiveRow, getRowDetail, updateCells, updateRowBody } from '@/lib/databases/rows';

type Ctx = { params: Promise<{ databaseId: string; rowId: string }> };

// v0.9.9 Plan F1 (#241) — PATCH accepts cells, body, or both. `cells` routes
// through updateCells; `body` through updateRowBody. At least one is required.
const PatchInput = z.object({
  cells: z.record(z.string(), z.unknown()).optional(),
  body: z.unknown().optional(),
});

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('viewer');
    const { databaseId, rowId } = await params;
    const detail = await getRowDetail(getDb(), {
      rowId,
      databaseId,
      workspaceId: ctx.workspaceId,
    });
    return NextResponse.json(detail);
  } catch (err) {
    return errToResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { databaseId, rowId } = await params;
    const parsed = PatchInput.parse(await req.json());
    if (parsed.cells) {
      await updateCells(getDb(), {
        rowId,
        databaseId,
        workspaceId: ctx.workspaceId,
        cells: parsed.cells,
      });
    }
    if (parsed.body !== undefined) {
      await updateRowBody(getDb(), {
        rowId,
        databaseId,
        workspaceId: ctx.workspaceId,
        body: parsed.body,
      });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errToResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { databaseId, rowId } = await params;
    await archiveRow(getDb(), { rowId, databaseId, workspaceId: ctx.workspaceId });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errToResponse(err);
  }
}
