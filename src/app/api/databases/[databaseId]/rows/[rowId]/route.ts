import { getDb } from '@/db/client';
import { requireRole } from '@/lib/auth/require-role';
import { errToResponse } from '@/lib/databases/route-errors';
import { archiveRow, updateCells } from '@/lib/databases/rows';
import { NextResponse } from 'next/server';
import { z } from 'zod';

type Ctx = { params: Promise<{ databaseId: string; rowId: string }> };

const PatchInput = z.object({
  cells: z.record(z.string(), z.unknown()),
});

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const ctx = await requireRole('editor');
    const { databaseId, rowId } = await params;
    const parsed = PatchInput.parse(await req.json());
    await updateCells(getDb(), {
      rowId,
      databaseId,
      workspaceId: ctx.workspaceId,
      cells: parsed.cells,
    });
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
